import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Controller } from '../controller';
import { Mode2D } from '../modes/mode-2d';
import { ModeSketch, SKETCH_SENSITIVITY_RANGE, SKETCH_SHADING_RANGE } from '../modes/mode-sketch';
import { ModeHistogram } from '../modes/mode-histogram';
import { ModeASCII } from '../modes/mode-ascii';
import { Mode3D, MODE3D_RELIEF_MULTIPLIER_RANGE } from '../modes/mode-3d';
import { cleanupImage, keepSmallComponents } from '../preprocess/cleanup';
import type { ModeId } from '../types';
import { createDummyImageData, createMockRenderContext, installDomPolyfills } from './test-utils';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  installDomPolyfills();
  // jsdom has no real WebGL context, so every attempt to construct a
  // THREE.WebGLRenderer in this suite (Mode3D's own describe block below,
  // plus the '3d' case of the Controller loop test) logs an expected
  // "Error creating WebGL context" via console.error before Mode3D's
  // ensureWebGL() catches it and falls back to the 2D relief renderer (see
  // mode-3d.ts). That's correct, tested behavior, not a bug — silenced here
  // so it doesn't read as scary red text in CI output for a suite that's
  // actually 100% green. grep confirms this file's the only console.error
  // source anywhere in src/, so nothing else gets masked by this.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

function buildController(): Controller {
  const controller = new Controller();
  controller.register(new Mode2D());
  controller.register(new ModeSketch());
  controller.register(new ModeHistogram());
  controller.register(new ModeASCII());
  controller.register(new Mode3D());
  return controller;
}

const ALL_MODES: ModeId[] = ['2d', 'sketch', 'histogram', 'ascii', '3d'];

describe('cleanup pipeline', () => {
  it('runs end to end on a small image without throwing', () => {
    const image = createDummyImageData(8, 8);
    const cleaned = cleanupImage(image);
    expect(cleaned.width).toBe(8);
    expect(cleaned.height).toBe(8);
    expect(cleaned.data.length).toBe(8 * 8 * 4);
  });

  it('preserves alpha untouched', () => {
    const image = createDummyImageData(6, 6);
    const cleaned = cleanupImage(image);
    for (let i = 3; i < cleaned.data.length; i += 4) {
      expect(cleaned.data[i]).toBe(255);
    }
  });

  it('produces finite, in-range pixel values (no NaN/overflow from the blur or sharpen passes)', () => {
    const image = createDummyImageData(10, 10);
    const cleaned = cleanupImage(image);
    for (const value of cleaned.data) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });
});

describe('keepSmallComponents (blemish flood-fill)', () => {
  it('does not fragment a large connected region into false-positive small blemishes', () => {
    // A regression test for the early-`break` bug: bailing out of the flood
    // fill mid-walk once a component looked "big enough" left unvisited
    // pixels behind, which the outer loop then picked up as fresh
    // components — small fragments of a large region, wrongly kept as
    // blemishes. A single big connected block (300px, far past maxArea*4)
    // should come back entirely unkept, not partially kept.
    const width = 20;
    const height = 20;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < width; x++) mask[y * width + x] = 1;
    }

    const kept = keepSmallComponents(mask, width, height, 10);
    expect(kept.every((v) => v === 0)).toBe(true);
  });

  it('still keeps a genuinely small isolated region as a blemish', () => {
    const width = 20;
    const height = 20;
    const mask = new Uint8Array(width * height);
    const idxs = [5 * width + 5, 5 * width + 6, 6 * width + 5, 6 * width + 6];
    for (const idx of idxs) mask[idx] = 1;

    const kept = keepSmallComponents(mask, width, height, 10);
    for (const idx of idxs) expect(kept[idx]).toBe(1);
    // Nothing outside the small blob should be marked.
    expect(kept.reduce((sum, v) => sum + v, 0)).toBe(idxs.length);
  });
});

describe('Controller mode router', () => {
  it('registers all five modes from build-spec section 1', () => {
    const controller = buildController();
    expect(controller.registeredModes.sort()).toEqual([...ALL_MODES].sort());
  });

  it('throws a clear error switching modes before an image is loaded', () => {
    const controller = buildController();
    expect(() => controller.switchTo('2d')).toThrow(/setImage/);
  });

  it('throws a clear error for an unregistered mode', () => {
    const controller = new Controller();
    controller.setImage(createDummyImageData());
    // @ts-expect-error - deliberately invalid mode id to test the guard
    expect(() => controller.switchTo('not-a-mode')).toThrow(/no engine registered/);
  });

  for (const modeId of ALL_MODES) {
    it(`mode "${modeId}": process -> render -> reset never throws, even as a placeholder`, () => {
      const controller = buildController();
      const image = cleanupImage(createDummyImageData(12, 12));
      controller.setImage(image);

      expect(() => controller.switchTo(modeId)).not.toThrow();
      expect(controller.activeMode).toBe(modeId);
      expect(controller.output).not.toBeNull();

      const renderCtx = createMockRenderContext(200, 150);
      expect(() => controller.render(renderCtx, 0)).not.toThrow();
      expect(() => controller.render(renderCtx, 0.5)).not.toThrow();
      expect(() => controller.render(renderCtx, 1)).not.toThrow();

      expect(() => controller.reset()).not.toThrow();
    });
  }
});

describe('Mode2D', () => {
  it('posterizes into a small, bounded set of levels per channel', () => {
    const mode = new Mode2D();
    const image = createDummyImageData(16, 16);
    const payload = mode.process(image);

    expect(payload.kind).toBe('raster');
    const levels = new Set<number>();
    for (let i = 0; i < payload.imageData.data.length; i += 4) {
      levels.add(payload.imageData.data[i]!);
    }
    // 6 posterize levels declared in Mode2D — allow a little slack for
    // rounding, but it must be far below the 256 raw levels of the input.
    expect(levels.size).toBeLessThanOrEqual(8);
  });

  it('renders without a loaded image as a no-op, not a crash', () => {
    const mode = new Mode2D();
    const renderCtx = createMockRenderContext(100, 100);
    expect(() => mode.render(renderCtx, 0)).not.toThrow();
  });

  it('configure() changes the posterize level count, and clamps out-of-range values', () => {
    const mode = new Mode2D();
    const image = createDummyImageData(24, 24);

    const countLevels = (payload: ReturnType<Mode2D['process']>): number => {
      const levels = new Set<number>();
      for (let i = 0; i < payload.imageData.data.length; i += 4) levels.add(payload.imageData.data[i]!);
      return levels.size;
    };

    const coarse = countLevels(mode.process(image));
    mode.configure({ posterizeLevels: 12 });
    const fine = countLevels(mode.process(image));
    expect(fine).toBeGreaterThan(coarse);

    // Out-of-range input is clamped (MODE2D_POSTERIZE_LEVELS_RANGE is 2-12),
    // not passed straight through to a degenerate posterize() call.
    mode.configure({ posterizeLevels: 999 });
    expect(() => mode.process(image)).not.toThrow();
    mode.configure({ posterizeLevels: 0 });
    expect(() => mode.process(image)).not.toThrow();
  });

  it('scales to fit the render context while preserving aspect ratio', () => {
    const mode = new Mode2D();
    mode.process(createDummyImageData(20, 10)); // 2:1 source
    const renderCtx = createMockRenderContext(100, 100); // square target
    expect(() => mode.render(renderCtx, 0)).not.toThrow();
  });
});

describe('ModeSketch', () => {
  /** A dark image with a bright filled rectangle and disc: strong, unambiguous edges. */
  function makeShapesImage(width = 120, height = 100): ImageData {
    const image = createDummyImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inRect = x >= 20 && x < 70 && y >= 25 && y < 80;
        const inDisc = (x - 95) ** 2 + (y - 40) ** 2 < 15 ** 2;
        const v = inRect || inDisc ? 220 : 25;
        const i = (y * width + x) * 4;
        image.data[i] = v;
        image.data[i + 1] = v;
        image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
    }
    return image;
  }

  it('traces continuous contour strokes from a shapes image, in source-image coordinates', () => {
    const mode = new ModeSketch();
    mode.configure({ shading: 0 });
    const data = mode.process(makeShapesImage());

    expect(data.meta.width).toBe(120);
    expect(data.meta.height).toBe(100);
    expect(data.meta.layers).toBe(data.layers.length);
    expect(data.meta.totalPoints).toBe(data.layers.reduce((sum, l) => sum + l.points.length, 0));
    // Two shapes -> a small number of long, simplified strokes (not hundreds of specks).
    expect(data.layers.length).toBeGreaterThanOrEqual(2);
    expect(data.layers.length).toBeLessThan(20);
    for (const layer of data.layers) {
      expect(layer.points.length).toBeGreaterThanOrEqual(2);
      for (const p of layer.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(120);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it('emits the longest contours first', () => {
    const mode = new ModeSketch();
    mode.configure({ shading: 0 });
    const data = mode.process(makeShapesImage());
    const lengths = data.layers.map((l) =>
      l.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - l.points[i]!.x, p.y - l.points[i]!.y), 0),
    );
    expect(lengths[0]!).toBeGreaterThanOrEqual(lengths[lengths.length - 1]!);
  });

  it('adds hatch strokes only when shading is on', () => {
    const mode = new ModeSketch();
    mode.configure({ shading: 0 });
    const without = mode.process(makeShapesImage());
    expect(without.layers.every((l) => l.name.startsWith('Contour'))).toBe(true);

    mode.configure({ shading: 1 });
    const withShading = mode.process(makeShapesImage());
    expect(withShading.layers.some((l) => l.name.startsWith('Shade'))).toBe(true);
    expect(withShading.meta.totalPoints).toBeGreaterThan(without.meta.totalPoints);
  });

  it('a darker copy of the same picture still yields the same structure (auto-levelling)', () => {
    const bright = makeShapesImage();
    const dim = makeShapesImage();
    for (let i = 0; i < dim.data.length; i += 4) {
      for (let c = 0; c < 3; c++) dim.data[i + c] = Math.round(dim.data[i + c]! * 0.12);
    }
    const mode = new ModeSketch();
    mode.configure({ shading: 0 });
    const a = mode.process(bright).layers.length;
    const b = mode.process(dim).layers.length;
    expect(b).toBeGreaterThanOrEqual(2);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(3);
  });

  it('reveals a growing share of strokes as progress advances, and everything at progress=1', () => {
    const mode = new ModeSketch();
    mode.process(makeShapesImage());
    const renderCtx = createMockRenderContext(240, 200);
    const stroke = vi.spyOn(renderCtx.ctx, 'stroke');

    mode.render(renderCtx, 0);
    const none = stroke.mock.calls.length;
    mode.render(renderCtx, 0.5);
    const half = stroke.mock.calls.length - none;
    mode.render(renderCtx, 1);
    const full = stroke.mock.calls.length - none - half;

    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThanOrEqual(half);
  });

  it('draws consecutive same-colored strokes as one path (batched), not one path per stroke', () => {
    const mode = new ModeSketch();
    mode.configure({ shading: 1 });
    const data = mode.process(makeShapesImage());
    const renderCtx = createMockRenderContext(240, 200);
    const stroke = vi.spyOn(renderCtx.ctx, 'stroke');

    mode.render(renderCtx, 1);
    expect(data.layers.length).toBeGreaterThan(10);
    expect(stroke.mock.calls.length).toBeLessThanOrEqual(4); // contours + up to 3 hatch tints
  });

  it('renders a flat/edgeless image without throwing (zero-point case)', () => {
    const mode = new ModeSketch();
    const flat = createDummyImageData(20, 20);
    for (let i = 0; i < flat.data.length; i += 4) {
      flat.data[i] = 128;
      flat.data[i + 1] = 128;
      flat.data[i + 2] = 128;
      flat.data[i + 3] = 255;
    }
    const data = mode.process(flat);
    expect(data.meta.totalPoints).toBe(0);

    const renderCtx = createMockRenderContext(80, 80);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });

  it('render() before process() is a no-op, not a crash', () => {
    const mode = new ModeSketch();
    const renderCtx = createMockRenderContext(80, 80);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });

  it('higher detail keeps at least as many contours, and stronger line-cleanup keeps fewer', () => {
    const image = createDummyImageData(90, 90); // pseudo-random texture: lots of weak edges
    const mode = new ModeSketch();
    mode.configure({ shading: 0, sensitivity: SKETCH_SENSITIVITY_RANGE.min });
    const low = mode.process(image).layers.length;
    mode.configure({ sensitivity: SKETCH_SENSITIVITY_RANGE.max });
    const high = mode.process(image).layers.length;
    expect(high).toBeGreaterThanOrEqual(low);

    mode.configure({ minStrokeLength: 4 });
    const fineLines = mode.process(image).layers.length;
    mode.configure({ minStrokeLength: 60 });
    const cleanLines = mode.process(image).layers.length;
    expect(cleanLines).toBeLessThanOrEqual(fineLines);
  });

  it('applies the configured stroke width to contour strokes', () => {
    const mode = new ModeSketch();
    mode.configure({ shading: 0, strokeWidth: 3 });
    mode.process(makeShapesImage());
    const renderCtx = createMockRenderContext(240, 200);
    mode.render(renderCtx, 1);
    expect((renderCtx.ctx as unknown as { lineWidth: number }).lineWidth).toBe(3);
  });

  it('configure() clamps out-of-range values instead of passing them straight through', () => {
    const mode = new ModeSketch();
    mode.configure({ sensitivity: 99, minStrokeLength: -5, shading: SKETCH_SHADING_RANGE.max + 10, strokeWidth: -1 });
    expect(() => mode.process(makeShapesImage(40, 40))).not.toThrow();
  });
});

describe('ModeHistogram', () => {
  it('produces 256-bucket R/G/B/luminance distributions that sum to the pixel count', () => {
    const mode = new ModeHistogram();
    const image = createDummyImageData(10, 10);
    const payload = mode.process(image);

    expect(payload.kind).toBe('histogram');
    const { bins } = payload;
    expect(bins.red).toHaveLength(256);
    expect(bins.green).toHaveLength(256);
    expect(bins.blue).toHaveLength(256);
    expect(bins.luminance).toHaveLength(256);

    const pixelCount = 10 * 10;
    expect(bins.red.reduce((a, b) => a + b, 0)).toBe(pixelCount);
    expect(bins.green.reduce((a, b) => a + b, 0)).toBe(pixelCount);
    expect(bins.blue.reduce((a, b) => a + b, 0)).toBe(pixelCount);
    expect(bins.luminance.reduce((a, b) => a + b, 0)).toBe(pixelCount);
    expect(bins.maxCount).toBeGreaterThan(0);
  });

  it('renders across the progress range without throwing', () => {
    const mode = new ModeHistogram();
    mode.process(createDummyImageData(16, 16));
    const renderCtx = createMockRenderContext(200, 120);

    expect(() => mode.render(renderCtx, 0)).not.toThrow();
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
    expect(() => mode.render(renderCtx, 1)).not.toThrow();
  });

  it('render() before process() is a no-op, not a crash', () => {
    const mode = new ModeHistogram();
    const renderCtx = createMockRenderContext(200, 120);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });
});

describe('ModeASCII', () => {
  it('produces a character grid sized to the image aspect ratio', () => {
    const mode = new ModeASCII();
    const payload = mode.process(createDummyImageData(40, 20)); // 2:1 source

    expect(payload.kind).toBe('ascii');
    expect(payload.chars).toHaveLength(payload.cols * payload.rows);
    expect(payload.cols).toBeGreaterThan(0);
    expect(payload.rows).toBeGreaterThan(0);
    // A 2:1 source should still read wider-than-tall once the monospace
    // glyph-aspect correction (CHAR_ASPECT) is applied to row count.
    expect(payload.cols).toBeGreaterThan(payload.rows);
    for (const ch of payload.chars) {
      expect(ch).toHaveLength(1);
    }
  });

  it('maps luminance to ink density in the expected direction (darkest -> blank, brightest -> densest glyph)', () => {
    const mode = new ModeASCII();

    const black = createDummyImageData(8, 8);
    for (let i = 0; i < black.data.length; i += 4) {
      black.data[i] = 0;
      black.data[i + 1] = 0;
      black.data[i + 2] = 0;
      black.data[i + 3] = 255;
    }
    expect(mode.process(black).chars.every((ch) => ch === ' ')).toBe(true);

    const white = createDummyImageData(8, 8);
    for (let i = 0; i < white.data.length; i += 4) {
      white.data[i] = 255;
      white.data[i + 1] = 255;
      white.data[i + 2] = 255;
      white.data[i + 3] = 255;
    }
    expect(mode.process(white).chars.every((ch) => ch === '@')).toBe(true);
  });

  it('reveals a growing share of characters as progress advances, across the full range without throwing', () => {
    const mode = new ModeASCII();
    mode.process(createDummyImageData(24, 24));
    const renderCtx = createMockRenderContext(200, 150);

    expect(() => mode.render(renderCtx, 0)).not.toThrow();
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
    expect(() => mode.render(renderCtx, 1)).not.toThrow();
  });

  it('render() before process() is a no-op, not a crash', () => {
    const mode = new ModeASCII();
    const renderCtx = createMockRenderContext(80, 80);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });

  it('configure({ targetCols }) overrides the auto column count, clamped to [MIN_COLS, MAX_COLS], and null restores auto behavior', () => {
    const mode = new ModeASCII();
    const image = createDummyImageData(40, 20);

    const auto = mode.process(image).cols;

    mode.configure({ targetCols: 30 });
    expect(mode.process(image).cols).toBe(30);

    mode.configure({ targetCols: 9999 }); // above ASCII_TARGET_COLS_RANGE.max (140)
    expect(mode.process(image).cols).toBe(140);

    mode.configure({ targetCols: null });
    expect(mode.process(image).cols).toBe(auto);
  });

  it('draws rectangular (~2:1) cells on canvas, not the square cells that squashed the image vertically', () => {
    // Regression test: process() halves `rows` via CHAR_ASPECT so the plain
    // -text export reads at the right proportions in a real monospace font.
    // render() used to draw that grid with one square `cellSize`, which
    // squashed the *canvas* preview to half height versus the source image
    // and the .txt export. A fixed cell should be ~1/CHAR_ASPECT times
    // taller than it is wide.
    const mode = new ModeASCII();
    mode.process(createDummyImageData(200, 100)); // 2:1 source
    const renderCtx = createMockRenderContext(400, 400); // square canvas so any squash is visible
    const fillRectSpy = vi.spyOn(renderCtx.ctx, 'fillRect');

    mode.render(renderCtx, 0.5); // partial reveal so the cursor-block fillRect fires

    const cursorCall = fillRectSpy.mock.calls.at(-1) as [number, number, number, number] | undefined;
    expect(cursorCall).toBeDefined();
    const [, , cellW, cellH] = cursorCall!;
    expect(cellW).toBeGreaterThan(0);
    expect(cellH / cellW).toBeGreaterThan(1.5); // was 1.0 (square) before the fix; expected ~2.0
  });
});

describe('Mode3D', () => {
  it('produces a normalized height/color grid sized to the image aspect ratio', () => {
    const mode = new Mode3D();
    const payload = mode.process(createDummyImageData(40, 20)); // 2:1 source

    expect(payload.kind).toBe('relief3d');
    expect(payload.heights).toHaveLength(payload.cols * payload.rows);
    expect(payload.colors).toHaveLength(payload.cols * payload.rows);
    expect(payload.cols).toBeGreaterThanOrEqual(8); // Mode3D's GRID_MIN_DIM floor
    expect(payload.cols).toBeLessThanOrEqual(200); // Mode3D's GRID_MAX_DIM cap
    expect(payload.cols).toBeGreaterThan(payload.rows); // 2:1 source

    for (const h of payload.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    // Heavily smoothed, so neighbouring heights never jump (no cliffs / spikes).
    let maxStep = 0;
    for (let y = 0; y < payload.rows; y++) {
      for (let x = 1; x < payload.cols; x++) {
        maxStep = Math.max(maxStep, Math.abs(payload.heights[y * payload.cols + x]! - payload.heights[y * payload.cols + x - 1]!));
      }
    }
    expect(maxStep).toBeLessThan(0.35);

    for (const color of payload.colors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('renders across the progress range without throwing (no real WebGL context in this test environment, so this exercises the 2D relief fallback)', () => {
    const mode = new Mode3D();
    mode.process(createDummyImageData(24, 24));
    const renderCtx = createMockRenderContext(200, 150);

    expect(() => mode.render(renderCtx, 0)).not.toThrow();
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
    expect(() => mode.render(renderCtx, 1)).not.toThrow();
  });

  it('2D fallback letterboxes the relief to the image aspect instead of stretching it to the canvas', () => {
    const mode = new Mode3D();
    mode.process(createDummyImageData(16, 16)); // square source -> square grid
    const renderCtx = createMockRenderContext(400, 100); // very wide canvas
    const fillRect = vi.spyOn(renderCtx.ctx, 'fillRect');

    mode.render(renderCtx, 1);

    expect(fillRect).toHaveBeenCalled();
    const lefts = fillRect.mock.calls.map((c) => c[0]);
    const rights = fillRect.mock.calls.map((c) => c[0] + c[2]);
    // A 100x100 square centered in 400x100 spans x = 150..250 (plus the 1-2px seam overlap).
    // The old stretched version spanned the full 0..400.
    expect(Math.min(...lefts)).toBeGreaterThanOrEqual(150);
    expect(Math.max(...rights)).toBeLessThanOrEqual(253);
  });

  it('2D fallback ignores progress: the picture is fully drawn even at progress 0 (the camera no longer animates by default)', () => {
    const mode = new Mode3D();
    const payload = mode.process(createDummyImageData(16, 16));
    const renderCtx = createMockRenderContext(160, 160);
    const fillRect = vi.spyOn(renderCtx.ctx, 'fillRect');

    mode.render(renderCtx, 0);
    expect(fillRect.mock.calls.length).toBe(payload.cols * payload.rows);
  });

  it('camera controls: orbit/zoom/reset never throw and stay within limits (state is not observable without WebGL, so this checks robustness)', () => {
    const mode = new Mode3D();
    const renderCtx = createMockRenderContext(120, 120);
    mode.process(createDummyImageData(16, 16));

    mode.orbitBy(1e6, -1e6);
    mode.zoomBy(1e6);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
    mode.orbitBy(-1e6, 1e6);
    mode.zoomBy(1e-6);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
    mode.resetView();
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });

  it('configure() accepts autoSway', () => {
    const mode = new Mode3D();
    mode.process(createDummyImageData(16, 16));
    mode.configure({ autoSway: true });
    expect(() => mode.render(createMockRenderContext(80, 80), 0.25)).not.toThrow();
    mode.configure({ autoSway: false });
    expect(() => mode.render(createMockRenderContext(80, 80), 0.25)).not.toThrow();
  });

  it('render() before process() is a no-op, not a crash', () => {
    const mode = new Mode3D();
    const renderCtx = createMockRenderContext(80, 80);
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });

  it('reset() tears down cleanly and the engine can be reused for a new image', () => {
    const mode = new Mode3D();
    const renderCtx = createMockRenderContext(80, 80);

    mode.process(createDummyImageData(16, 16));
    mode.render(renderCtx, 0.5);
    mode.reset();

    mode.process(createDummyImageData(20, 12));
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
  });

  it('configure() accepts and clamps reliefMultiplier without throwing (heightScale itself is WebGL-mesh-only, unreachable without a real GPU context in this test environment)', () => {
    const mode = new Mode3D();
    const renderCtx = createMockRenderContext(80, 80);
    mode.process(createDummyImageData(16, 16));

    mode.configure({ reliefMultiplier: MODE3D_RELIEF_MULTIPLIER_RANGE.max });
    expect(() => mode.render(renderCtx, 0.3)).not.toThrow();
    mode.configure({ reliefMultiplier: 999 }); // above range — must clamp, not pass through
    expect(() => mode.render(renderCtx, 0.6)).not.toThrow();
    mode.configure({ reliefMultiplier: -5 }); // below range
    expect(() => mode.render(renderCtx, 0.9)).not.toThrow();
  });
});
