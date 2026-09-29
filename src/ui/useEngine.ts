import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Controller } from '../engine/controller';
import { Timeline } from '../engine/timeline';
import { Mode2D, DEFAULT_MODE2D_OPTIONS, MODE2D_POSTERIZE_LEVELS_RANGE } from '../engine/modes/mode-2d';
import {
  ModeSketch,
  DEFAULT_SKETCH_OPTIONS,
  SKETCH_EDGE_PERCENTILE_RANGE,
  SKETCH_POINT_BUDGET_RANGE,
  SKETCH_STROKE_WIDTH_RANGE,
} from '../engine/modes/mode-sketch';
import { ModeHistogram } from '../engine/modes/mode-histogram';
import { ModeASCII, DEFAULT_ASCII_OPTIONS, ASCII_TARGET_COLS_RANGE } from '../engine/modes/mode-ascii';
import { Mode3D, DEFAULT_MODE3D_OPTIONS, MODE3D_RELIEF_MULTIPLIER_RANGE } from '../engine/modes/mode-3d';
import { DEFAULT_CLEANUP_OPTIONS, type CleanupOptions } from '../engine/preprocess/cleanup';
import { createCleanupWorkerClient } from '../engine/preprocess/cleanup-client';
import type { ModeId, RenderContext, RenderPayload, StrokeData } from '../engine/types';

// Bounds cleanup cost regardless of which thread it runs on — a 1600px cap
// keeps a phone-camera-sized upload (often 4000px+ on the long edge) from
// turning every cleanup pass into a multi-second job even off the main
// thread. This used to also be the thing keeping the *page* responsive
// during cleanup (see cleanup-client.ts / cleanup-worker.ts — that pipeline
// now runs off-thread), but the raw processing-time/memory bound is still
// worth keeping independent of that.
const MAX_DIMENSION = 1600;

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ImageSummary {
  fileName: string;
  fileSizeKB: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// docs/controls-spec.md section 3 — interactive controls.
//
// Flat, UI-facing state (as opposed to CleanupOptions' nested shape, or each
// mode's own *Options interface) so the settings panel has one object to
// read from and one callback to write through. buildCleanupOptions() below
// re-nests the four cleanup-related fields into a real CleanupOptions when
// they need to reach cleanupClient.run(); the mode-specific fields map
// directly onto each mode's own configure(partial) call.
// ---------------------------------------------------------------------------

export interface ControlsState {
  denoiseEnabled: boolean;
  spotRemovalEnabled: boolean;
  sharpenEnabled: boolean;
  sharpenAmount: number;
  posterizeLevels: number;
  edgePercentile: number;
  pointBudget: number;
  strokeWidth: number;
  asciiTargetCols: number | null;
  reliefMultiplier: number;
}

export const DEFAULT_CONTROLS: ControlsState = {
  denoiseEnabled: DEFAULT_CLEANUP_OPTIONS.denoise.enabled,
  spotRemovalEnabled: DEFAULT_CLEANUP_OPTIONS.spotRemoval.enabled,
  sharpenEnabled: DEFAULT_CLEANUP_OPTIONS.sharpen.enabled,
  sharpenAmount: DEFAULT_CLEANUP_OPTIONS.sharpen.amount,
  posterizeLevels: DEFAULT_MODE2D_OPTIONS.posterizeLevels,
  edgePercentile: DEFAULT_SKETCH_OPTIONS.edgePercentile,
  pointBudget: DEFAULT_SKETCH_OPTIONS.pointBudget,
  strokeWidth: DEFAULT_SKETCH_OPTIONS.strokeWidth,
  asciiTargetCols: DEFAULT_ASCII_OPTIONS.targetCols,
  reliefMultiplier: DEFAULT_MODE3D_OPTIONS.reliefMultiplier,
};

/** Re-exported so the settings panel can drive slider min/max from the same numbers the engines actually clamp against, rather than duplicating them. */
export const CONTROLS_RANGES = {
  sharpenAmount: { min: 0, max: 1.5 },
  posterizeLevels: MODE2D_POSTERIZE_LEVELS_RANGE,
  edgePercentile: SKETCH_EDGE_PERCENTILE_RANGE,
  pointBudget: SKETCH_POINT_BUDGET_RANGE,
  strokeWidth: SKETCH_STROKE_WIDTH_RANGE,
  asciiTargetCols: ASCII_TARGET_COLS_RANGE,
  reliefMultiplier: MODE3D_RELIEF_MULTIPLIER_RANGE,
} as const;

const CLEANUP_FIELD_KEYS: readonly (keyof ControlsState)[] = [
  'denoiseEnabled',
  'spotRemovalEnabled',
  'sharpenEnabled',
  'sharpenAmount',
];

function buildCleanupOptions(controls: ControlsState): CleanupOptions {
  return {
    denoise: { enabled: controls.denoiseEnabled },
    spotRemoval: { ...DEFAULT_CLEANUP_OPTIONS.spotRemoval, enabled: controls.spotRemovalEnabled },
    sharpen: { ...DEFAULT_CLEANUP_OPTIONS.sharpen, enabled: controls.sharpenEnabled, amount: controls.sharpenAmount },
  };
}

/**
 * Owns the Controller + Timeline + registered mode engines for the lifetime
 * of the component, and drives the canvas imperatively via `canvasRef`.
 * React state here is UI-facing status only (status/error/summary/active
 * mode) — never per-frame render state.
 */
export function useEngine(canvasRef: RefObject<HTMLCanvasElement>) {
  const controllerRef = useRef<Controller | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const cleanedImageRef = useRef<ImageData | null>(null);
  // The decoded-but-not-yet-cleaned upload, kept around so a cleanup option
  // change (see updateControls) can re-run the pipeline without re-decoding
  // the file.
  const rawImageRef = useRef<ImageData | null>(null);
  const cleanupClientRef = useRef<ReturnType<typeof createCleanupWorkerClient> | null>(null);

  // Controller only exposes the shared ModeEngine surface (process/render/
  // reset — build-spec section 5's locked contract). configure() (see each
  // mode file / docs/controls-spec.md 3.1) is deliberately *not* part of that
  // interface, so reaching it means holding a typed reference to the actual
  // instance alongside registering it with the Controller.
  const mode2DRef = useRef<Mode2D | null>(null);
  const modeSketchRef = useRef<ModeSketch | null>(null);
  const modeASCIIRef = useRef<ModeASCII | null>(null);
  const mode3DRef = useRef<Mode3D | null>(null);

  if (!controllerRef.current) {
    const controller = new Controller();
    const mode2D = new Mode2D();
    const modeSketch = new ModeSketch();
    const modeASCII = new ModeASCII();
    const mode3D = new Mode3D();
    controller.register(mode2D);
    controller.register(modeSketch);
    controller.register(new ModeHistogram());
    controller.register(modeASCII);
    controller.register(mode3D);
    controllerRef.current = controller;
    mode2DRef.current = mode2D;
    modeSketchRef.current = modeSketch;
    modeASCIIRef.current = modeASCII;
    mode3DRef.current = mode3D;
  }
  if (!timelineRef.current) {
    timelineRef.current = new Timeline({ durationMs: 2000, loop: false });
  }
  if (!cleanupClientRef.current) {
    cleanupClientRef.current = createCleanupWorkerClient();
  }

  // Non-null locals: initialized synchronously above, every render.
  const controller = controllerRef.current;
  const timeline = timelineRef.current;
  const cleanupClient = cleanupClientRef.current;

  // The worker (if any) is scoped to this component instance's lifetime.
  useEffect(() => () => cleanupClient.terminate(), [cleanupClient]);

  const [activeMode, setActiveMode] = useState<ModeId>('2d');
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageSummary, setImageSummary] = useState<ImageSummary | null>(null);
  const [controls, setControls] = useState<ControlsState>(DEFAULT_CONTROLS);
  // Mirrors controller.output into React state — Controller is a plain,
  // non-reactive class (per build-spec section 4), so anything the UI needs
  // to read (ExportControl needs the current mode's StrokeData/RenderPayload
  // for its SVG/TXT/CSV exports) has to be copied out on every process()
  // call, same treatment as imageSummary/activeMode/status above.
  const [currentOutput, setCurrentOutput] = useState<StrokeData | RenderPayload | null>(null);
  // Timeline's own `running` flag (read via toggleOrbit below) actually
  // drives the rAF loop — this is a separate mirror of it into React state,
  // for the same reason currentOutput mirrors Controller's output: Timeline
  // is a plain, non-reactive class, so calling timeline.play()/pause()
  // alone doesn't trigger a re-render, and the orbit button's label would
  // silently go stale without something reactive to read.
  const [isOrbitPlaying, setIsOrbitPlaying] = useState(true);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderCtx: RenderContext = { canvas, ctx, width: canvas.width, height: canvas.height };
    controller.render(renderCtx, timeline.progress);
  }, [canvasRef, controller, timeline]);

  // Shared tail for every path that produces a fresh mode output (upload,
  // mode switch, or a settings change) — see docs/controls-spec.md 3.1's "one
  // rule, no special cases" for why a settings tweak goes through the exact
  // same reset-and-replay sequence as switching modes, rather than trying
  // to special-case which options need a full replay vs. a static redraw.
  const applyProcessedOutput = useCallback(
    (id: ModeId, output: StrokeData | RenderPayload) => {
      setCurrentOutput(output);
      timeline.setLoop(id === '3d');
      timeline.setDuration(durationForMode(id, output));
      timeline.reset();
      renderFrame();
      timeline.play();
      setIsOrbitPlaying(true); // keep the mirror above in sync — see its comment
    },
    [renderFrame, timeline],
  );

  // Redraw whenever the timeline ticks. 2D ignores `progress` and just
  // redraws the same frame for its settle duration; Sketch, Histogram,
  // ASCII, and 3D all animate against it (stroke reveal, bar rise-in,
  // typewriter reveal, camera orbit, respectively).
  useEffect(() => timeline.onTick(renderFrame), [timeline, renderFrame]);

  // Mode3D loops its Timeline for a continuous camera orbit (see
  // Timeline.setLoop / mode-3d.ts). Every other mode stops calling rAF on
  // its own once it hits its one-shot duration, so this cleanup was a
  // no-op before; it's required now so leaving the page/component while on
  // 3D doesn't keep requestAnimationFrame firing forever.
  useEffect(() => () => timeline.pause(), [timeline]);

  // Keep the canvas backing store matched to its displayed size and DPR.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        renderFrame();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, renderFrame]);

  // Mode-dependent theme (build-spec section 6): set on <html> so every CSS
  // rule can key off it via `html[data-mode="..."]` without prop drilling.
  useEffect(() => {
    document.documentElement.dataset.mode = activeMode;
  }, [activeMode]);

  const switchMode = useCallback(
    (id: ModeId) => {
      setActiveMode(id);
      if (!cleanedImageRef.current) return;
      try {
        const output = controller.switchTo(id);
        applyProcessedOutput(id, output);
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to switch mode.');
      }
    },
    [applyProcessedOutput, controller],
  );

  const toggleOrbit = useCallback(() => {
    if (timeline.isRunning) {
      timeline.pause();
      setIsOrbitPlaying(false);
    } else {
      timeline.play();
      setIsOrbitPlaying(true);
    }
  }, [timeline]);

  const updateControls = useCallback(
    (partial: Partial<ControlsState>) => {
      const next: ControlsState = { ...controls, ...partial };
      setControls(next);

      const changesCleanup = CLEANUP_FIELD_KEYS.some((key) => key in partial);

      if (changesCleanup) {
        if (!rawImageRef.current) return; // nothing uploaded yet — the preference is remembered for next time
        cleanupClient.run(rawImageRef.current, buildCleanupOptions(next)).then((cleaned) => {
          cleanedImageRef.current = cleaned;
          controller.setImage(cleaned);
          try {
            const output = controller.switchTo(activeMode);
            applyProcessedOutput(activeMode, output);
          } catch (err) {
            setStatus('error');
            setErrorMessage(err instanceof Error ? err.message : 'Failed to apply the updated settings.');
          }
        });
        return;
      }

      if (!cleanedImageRef.current) return; // nothing uploaded yet

      if ('posterizeLevels' in partial) {
        mode2DRef.current?.configure({ posterizeLevels: next.posterizeLevels });
      }
      if ('edgePercentile' in partial || 'pointBudget' in partial || 'strokeWidth' in partial) {
        modeSketchRef.current?.configure({
          edgePercentile: next.edgePercentile,
          pointBudget: next.pointBudget,
          strokeWidth: next.strokeWidth,
        });
      }
      if ('asciiTargetCols' in partial) {
        modeASCIIRef.current?.configure({ targetCols: next.asciiTargetCols });
      }
      if ('reliefMultiplier' in partial) {
        mode3DRef.current?.configure({ reliefMultiplier: next.reliefMultiplier });
      }

      try {
        const output = controller.switchTo(activeMode);
        applyProcessedOutput(activeMode, output);
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to apply the updated settings.');
      }
    },
    [activeMode, applyProcessedOutput, cleanupClient, controller, controls],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setStatus('error');
        setErrorMessage("That file isn't an image — try a JPG, PNG, or WebP.");
        return;
      }

      setStatus('loading');
      setErrorMessage(null);
      setCurrentOutput(null);

      try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = fitWithinMax(bitmap.width, bitmap.height, MAX_DIMENSION);

        const decodeCanvas = document.createElement('canvas');
        decodeCanvas.width = width;
        decodeCanvas.height = height;
        const decodeCtx = decodeCanvas.getContext('2d');
        if (!decodeCtx) throw new Error('Could not acquire a 2D context to decode the image.');
        decodeCtx.drawImage(bitmap, 0, 0, width, height);
        const rawImageData = decodeCtx.getImageData(0, 0, width, height);
        rawImageRef.current = rawImageData;

        const cleaned = await cleanupClient.run(rawImageData, buildCleanupOptions(controls));
        cleanedImageRef.current = cleaned;

        controller.setImage(cleaned);
        const output = controller.switchTo(activeMode);
        applyProcessedOutput(activeMode, output);

        setImageSummary({ fileName: file.name, fileSizeKB: Math.round(file.size / 1024), width, height });
        setStatus('ready');
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Could not process that image.');
      }
    },
    [activeMode, applyProcessedOutput, cleanupClient, controller, controls],
  );

  return {
    activeMode,
    status,
    errorMessage,
    imageSummary,
    currentOutput,
    controls,
    updateControls,
    isOrbitPlaying,
    toggleOrbit,
    switchMode,
    loadFile,
  };
}

const SKETCH_MS_PER_POINT = 18;
const SKETCH_MIN_DURATION_MS = 1200;
const SKETCH_MAX_DURATION_MS = 5000;
const HISTOGRAM_DURATION_MS = 650;
const ASCII_DURATION_MS = 900; // long enough for the typewriter reveal to read as an effect, not an instant dump
const ROTATE_DURATION_MS = 16000; // one full 3D camera orbit — slow and ambient, not dizzying; Timeline loops this for '3d'
const STATIC_DURATION_MS = 700; // 2D: no real animation, just a settle frame

function durationForMode(id: ModeId, output: StrokeData | RenderPayload): number {
  if (id === 'sketch' && 'meta' in output) {
    const pointCount = output.meta.totalPoints;
    return Math.min(SKETCH_MAX_DURATION_MS, Math.max(SKETCH_MIN_DURATION_MS, pointCount * SKETCH_MS_PER_POINT));
  }
  if (id === 'histogram') return HISTOGRAM_DURATION_MS;
  if (id === 'ascii') return ASCII_DURATION_MS;
  if (id === '3d') return ROTATE_DURATION_MS;
  return STATIC_DURATION_MS;
}

function fitWithinMax(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
