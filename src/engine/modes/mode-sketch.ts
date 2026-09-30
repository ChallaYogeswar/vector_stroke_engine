import type { ModeEngine, StrokeData, RenderContext, Layer, Point, ImageMeta } from '../types';
import { clamp } from '../math';
import { readThemeColors, withAlpha } from '../theme';
import { buildHatching, buildToneMap, detectEdges, traceContours } from './sketch-trace';

// ---------------------------------------------------------------------------
// Sketch — "animated hand-drawn stroke reveal", the flagship mode.
//
// process() (once per upload / mode switch / settings change):
//   1. Tone map: downscale to a bounded working size and auto-level, so dark
//      or washed-out photos still have contrast (sketch-trace.ts).
//   2. Canny-style edges (blur -> Sobel -> non-max suppression -> hysteresis).
//   3. Trace connected edge pixels into continuous, smoothed, simplified
//      polylines; drop specks shorter than `minStrokeLength`.
//   4. Optional pen hatching in the shadows (`shading`).
//   Strokes are emitted longest-contour-first (the silhouette and main
//   features appear before fine detail), then hatch lines top to bottom.
//
// A `Layer` is one continuous pen stroke; `ImageMeta.layers` is the stroke
// count. Contours draw in the bold accent color, hatching in a lighter tint.
//
// render() reveals strokes in order using `progress` as a global point budget.
// Consecutive strokes sharing a color are drawn as one canvas path, so the
// thousands of short hatch lines cost a handful of draw calls per frame.
// ---------------------------------------------------------------------------

const DEFAULT_STROKE_WIDTH = 1.4;
const HATCH_WIDTH_FACTOR = 0.7;

export interface SketchOptions {
  /** 0..1 — how much edge structure survives. Higher = more, finer lines. */
  sensitivity: number;
  /** Minimum contour length, in working-space pixels (~ a 720px-wide image). Higher = cleaner, fewer specks. */
  minStrokeLength: number;
  /** 0..1 — pen hatching in shadows. 0 = off. */
  shading: number;
  /** Canvas lineWidth for contour strokes (hatching is drawn thinner). */
  strokeWidth: number;
}

export const DEFAULT_SKETCH_OPTIONS: SketchOptions = {
  sensitivity: 0.65,
  minStrokeLength: 12,
  shading: 0.5,
  strokeWidth: DEFAULT_STROKE_WIDTH,
};

export const SKETCH_SENSITIVITY_RANGE = { min: 0.05, max: 1 } as const;
export const SKETCH_MIN_STROKE_LENGTH_RANGE = { min: 4, max: 60 } as const;
export const SKETCH_SHADING_RANGE = { min: 0, max: 1 } as const;
export const SKETCH_STROKE_WIDTH_RANGE = { min: 0.5, max: 3 } as const;

export class ModeSketch implements ModeEngine {
  readonly id = 'sketch' as const;
  private options: SketchOptions = { ...DEFAULT_SKETCH_OPTIONS };
  private data: StrokeData | null = null;

  configure(partial: Partial<SketchOptions>): void {
    const next = { ...this.options, ...partial };
    this.options = {
      sensitivity: clamp(next.sensitivity, SKETCH_SENSITIVITY_RANGE.min, SKETCH_SENSITIVITY_RANGE.max),
      minStrokeLength: clamp(Math.round(next.minStrokeLength), SKETCH_MIN_STROKE_LENGTH_RANGE.min, SKETCH_MIN_STROKE_LENGTH_RANGE.max),
      shading: clamp(next.shading, SKETCH_SHADING_RANGE.min, SKETCH_SHADING_RANGE.max),
      strokeWidth: clamp(next.strokeWidth, SKETCH_STROKE_WIDTH_RANGE.min, SKETCH_STROKE_WIDTH_RANGE.max),
    };
  }

  process(image: ImageData): StrokeData {
    const theme = readThemeColors();
    const tone = buildToneMap(image);
    const { width: ww, height: wh, sx, sy } = tone;
    const toSource = (p: Point): Point => ({ x: p.x * sx, y: p.y * sy });

    const edges = detectEdges(tone.tone, ww, wh, this.options.sensitivity);
    const contours = traceContours(edges, ww, wh, this.options.minStrokeLength).sort((a, b) => b.length - a.length);

    const layers: Layer[] = [];
    contours.forEach((stroke, i) => {
      layers.push({ name: `Contour ${i + 1}`, stroke: theme.accentStrong, points: stroke.points.map(toSource) });
    });

    const hatch = buildHatching(tone.tone, ww, wh, this.options.shading);
    // Reveal hatching one tint at a time (light 45deg pass, then the crossing
    // pass, then the deepest), each sweeping top to bottom — like laying down
    // hatching and cross-hatching. Grouping by tint also lets render() batch
    // each pass into a single canvas path.
    hatch.sort((p, q) => p.level - q.level || p.a.y - q.a.y);
    const hatchColors = [withAlpha(theme.accent, 0.55), withAlpha(theme.accent, 0.47), withAlpha(theme.accent, 0.4)];
    hatch.forEach((h, i) => {
      layers.push({ name: `Shade ${i + 1}`, stroke: hatchColors[h.level]!, points: [toSource(h.a), toSource(h.b)] });
    });

    const totalPoints = layers.reduce((sum, l) => sum + l.points.length, 0);
    const meta: ImageMeta = { width: image.width, height: image.height, totalPoints, layers: layers.length };
    this.data = { meta, layers };
    return this.data;
  }

  render(renderCtx: RenderContext, progress: number): void {
    const { ctx, width, height } = renderCtx;
    ctx.clearRect(0, 0, width, height);
    if (!this.data) return;

    const { meta, layers } = this.data;
    if (meta.totalPoints === 0) {
      drawEmptyState(renderCtx);
      return;
    }

    const scale = Math.min(width / meta.width, height / meta.height);
    const offsetX = (width - meta.width * scale) / 2;
    const offsetY = (height - meta.height * scale) / 2;

    let budget = Math.floor(progress * meta.totalPoints);
    if (progress > 0 && budget === 0) budget = 1;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const contourWidth = this.options.strokeWidth;
    let batchStyle: string | null = null;
    let batchOpen = false;
    const flush = (): void => {
      if (batchOpen) {
        ctx.stroke();
        batchOpen = false;
      }
    };

    let partial: { layer: Layer; count: number } | null = null;
    for (const layer of layers) {
      if (budget <= 0) break;
      const count = Math.min(layer.points.length, budget);
      budget -= count;
      if (count < layer.points.length) {
        partial = { layer, count }; // the stroke currently being drawn
        break;
      }
      if (layer.points.length < 2) continue;

      if (layer.stroke !== batchStyle) {
        flush();
        batchStyle = layer.stroke;
        const isContour = layer.name.startsWith('Contour');
        ctx.beginPath();
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = isContour ? contourWidth : contourWidth * HATCH_WIDTH_FACTOR;
        ctx.shadowColor = layer.stroke;
        ctx.shadowBlur = isContour ? 1.5 : 0;
        batchOpen = true;
      }
      const first = layer.points[0]!;
      ctx.moveTo(offsetX + first.x * scale, offsetY + first.y * scale);
      for (let i = 1; i < layer.points.length; i++) {
        const p = layer.points[i]!;
        ctx.lineTo(offsetX + p.x * scale, offsetY + p.y * scale);
      }
    }
    flush();

    if (partial) drawPartialStroke(ctx, partial.layer, partial.count, scale, offsetX, offsetY, contourWidth);

    ctx.restore();
  }

  reset(): void {
    this.data = null;
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** The stroke mid-draw: its revealed prefix plus a glowing pen tip. */
function drawPartialStroke(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  count: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  strokeWidth: number,
): void {
  const toCanvas = (p: Point): Point => ({ x: offsetX + p.x * scale, y: offsetY + p.y * scale });
  if (count >= 2) {
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const { x, y } = toCanvas(layer.points[i]!);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = strokeWidth;
    ctx.shadowColor = layer.stroke;
    ctx.shadowBlur = 6;
    ctx.stroke();
  }
  const tip = toCanvas(layer.points[count - 1]!);
  ctx.beginPath();
  ctx.fillStyle = layer.stroke;
  ctx.shadowBlur = 8;
  ctx.arc(tip.x, tip.y, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawEmptyState(renderCtx: RenderContext): void {
  const { ctx, width, height } = renderCtx;
  const theme = readThemeColors();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.textTertiary;
  ctx.font = '400 13px "JetBrains Mono", monospace';
  ctx.fillText('NO STRONG EDGES DETECTED', width / 2, height / 2);
  ctx.restore();
}
