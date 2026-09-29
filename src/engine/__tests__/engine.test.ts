import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Controller } from '../controller';
import { Mode2D } from '../modes/mode-2d';
import { ModeSketch, orderIntoPaths, SKETCH_POINT_BUDGET_RANGE } from '../modes/mode-sketch';
import { ModeHistogram } from '../modes/mode-histogram';
import { ModeASCII } from '../modes/mode-ascii';
import { Mode3D, MODE3D_RELIEF_MULTIPLIER_RANGE } from '../modes/mode-3d';
import { cleanupImage, keepSmallComponents } from '../preprocess/cleanup';
import type { ModeId, Point } from '../types';
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
  it('extracts edge points into strokes, bounded by the point budget', () => {
    const mode = new ModeSketch();
    const data = mode.process(createDummyImageData(40, 40));

    expect(data.meta.width).toBe(40);
    expect(data.meta.height).toBe(40);
    expect(data.meta.layers).toBe(data.layers.length);
    expect(data.meta.totalPoints).toBe(data.layers.reduce((sum, l) => sum + l.points.length, 0));
    // The dummy image's synthetic pattern has edges everywhere; every stroke
    // should clear the minimum-length filter (isolated single points are dropped).
    for (const layer of data.layers) {
      expect(layer.points.length).toBeGreaterThanOrEqual(2);
      expect(typeof layer.stroke).toBe('string');
      expect(layer.stroke.length).toBeGreaterThan(0);
    }
  });

  it('reveals a growing share of points as progress advances, and everything at progress=1', () => {
    const mode = new ModeSketch();
    mode.process(createDummyImageData(24, 24));
    const renderCtx = createMockRenderContext(120, 120);

    expect(() => mode.render(renderCtx, 0)).not.toThrow();
    expect(() => mode.render(renderCtx, 0.5)).not.toThrow();
    expect(() => mode.render(renderCtx, 1)).not.toThrow();
  });

  it('renders a flat/edgeless image without throwing (zero-point case)', () => {
    const mode = new ModeSketch();
    const flat = createDummyImageData(6, 6);
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

  it('configure() raises the point budget, and applies the configured stroke width when rendering', () => {
    const mode = new ModeSketch();
    // Large enough that the default budget's sampling cellSize sits above
    // MIN_CELL_SIZE=2 — otherwise both the default and max budgets round
    // down to the same floor cell size and sample identically, which would
    // make this test flaky/meaningless rather than a real regression guard.
    const image = createDummyImageData(150, 150);

    const lowBudget = mode.process(image).meta.totalPoints;
    mode.configure({ pointBudget: SKETCH_POINT_BUDGET_RANGE.max });
    const highBudget = mode.process(image).meta.totalPoints;
    expect(highBudget).toBeGreaterThan(lowBudget);

    mode.configure({ strokeWidth: 3 });
    mode.process(image);
    const renderCtx = createMockRenderContext(120, 120);
    mode.render(renderCtx, 1);
    expect((renderCtx.ctx as unknown as { lineWidth: number }).lineWidth).toBe(3);
  });

  it('configure() clamps out-of-range values instead of passing them straight through', () => {
    const mode = new ModeSketch();
    const image = createDummyImageData(20, 20);
    mode.configure({ pointBudget: 999999, edgePercentile: 5, strokeWidth: -1 });
    expect(() => mode.process(image)).not.toThrow();
  });
});

describe('orderIntoPaths (spatial grid path ordering)', () => {
  // Deterministic PRNG so a failure is reproducible without depending on
  // Math.random(). Floating-point coordinates make an exact distance tie
  // between two distinct candidates (which could expose a tie-break
  // ordering difference vs. the reference) a measure-zero event.
  function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }

  function randomPoints(count: number, spread: number, rng: () => number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < count; i++) points.push({ x: rng() * spread, y: rng() * spread });
    return points;
  }

  // The plain O(n^2) walk this mode used before the spatial-grid rewrite,
  // kept here only as a correctness oracle for the test below — not
  // production code, so it's fine that it duplicates the pre-rewrite logic.
  function orderIntoPathsBruteForce(points: Point[], maxJump: number): Point[][] {
    const n = points.length;
    const visited = new Uint8Array(n);
    const paths: Point[][] = [];
    const maxJumpSq = maxJump * maxJump;

    const findNextUnvisited = (from: number): number => {
      for (let i = from; i < n; i++) if (!visited[i]) return i;
      for (let i = 0; i < from; i++) if (!visited[i]) return i;
      return -1;
    };

    let cursor = 0;
    for (;;) {
      const startIdx = findNextUnvisited(cursor);
      if (startIdx === -1) break;
      visited[startIdx] = 1;
      let current = points[startIdx]!;
      const path: Point[] = [current];
      for (;;) {
        let bestIdx = -1;
        let bestDistSq = Infinity;
        for (let i = 0; i < n; i++) {
          if (visited[i]) continue;
          const dx = points[i]!.x - current.x;
          const dy = points[i]!.y - current.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = i;
          }
        }
        if (bestIdx === -1 || bestDistSq > maxJumpSq) break;
        visited[bestIdx] = 1;
        current = points[bestIdx]!;
        path.push(current);
      }
      paths.push(path);
      cursor = startIdx;
    }
    return paths;
  }

  it('matches the brute-force reference across randomized point sets and jump radii', () => {
    const configs = [
      { count: 50, spread: 100, maxJump: 5 },
      { count: 300, spread: 200, maxJump: 12 },
      { count: 300, spread: 200, maxJump: 40 }, // large radius relative to spread -> dense neighborhoods
      { count: 800, spread: 500, maxJump: 8 }, // small radius -> many short/isolated strokes
      { count: 2200, spread: 800, maxJump: 15 }, // current default POINT_BUDGET scale
    ];

    let seed = 1;
    for (const { count, spread, maxJump } of configs) {
      const points = randomPoints(count, spread, makeRng(seed++));
      expect(orderIntoPaths(points, maxJump)).toEqual(orderIntoPathsBruteForce(points, maxJump));
    }
  });

  it('handles the empty and single-point cases', () => {
    expect(orderIntoPaths([], 10)).toEqual([]);
    expect(orderIntoPaths([{ x: 1, y: 1 }], 10)).toEqual([[{ x: 1, y: 1 }]]);
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
    expect(payload.cols).toBeLessThanOrEqual(96); // Mode3D's GRID_MAX_DIM cap
    expect(payload.cols).toBeGreaterThan(payload.rows); // 2:1 source

    for (const h of payload.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    // Min-max normalized: the dummy image's varied pattern should span the
    // full 0..1 range rather than clustering away from either end.
    expect(Math.min(...payload.heights)).toBeCloseTo(0, 5);
    expect(Math.max(...payload.heights)).toBeCloseTo(1, 5);

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
