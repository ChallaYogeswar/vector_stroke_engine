import { describe, expect, it } from 'vitest';
import {
  buildHatching,
  buildToneMap,
  detectEdges,
  gaussianBlur,
  simplifyPolyline,
  smoothPolyline,
  traceContours,
} from '../modes/sketch-trace';
import { createDummyImageData } from './test-utils';
import { installDomPolyfills } from './test-utils';
import { beforeAll } from 'vitest';

beforeAll(() => installDomPolyfills());

function solidImage(width: number, height: number, fn: (x: number, y: number) => number): ImageData {
  const image = createDummyImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y);
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

describe('buildToneMap', () => {
  it('downscales large images to the working size and reports per-axis scale', () => {
    const map = buildToneMap(solidImage(1440, 1080, (x) => x % 256), 720);
    expect(Math.max(map.width, map.height)).toBeLessThanOrEqual(720);
    expect(map.sx).toBeCloseTo(2, 1);
    expect(map.tone).toHaveLength(map.width * map.height);
  });

  it('never upsamples small images', () => {
    const map = buildToneMap(solidImage(50, 40, () => 100));
    expect(map.width).toBe(50);
    expect(map.height).toBe(40);
    expect(map.sx).toBe(1);
  });

  it('auto-levels a very dark image so its contrast reaches the full range', () => {
    const map = buildToneMap(solidImage(60, 60, (x) => (x < 30 ? 4 : 20)));
    expect(Math.min(...map.tone)).toBeLessThan(0.1);
    expect(Math.max(...map.tone)).toBeGreaterThan(0.9);
  });

  it('keeps a perfectly flat image flat', () => {
    const map = buildToneMap(solidImage(30, 30, () => 128));
    expect(new Set(map.tone).size).toBe(1);
  });
});

describe('gaussianBlur', () => {
  it('preserves the mean and smooths a step', () => {
    const w = 20;
    const src = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) src[y * w + x] = x < 10 ? 0 : 1;
    const out = gaussianBlur(src, w, w, 1.5);
    const mid = out[5 * w + 9]!;
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(out)).toBeCloseTo(mean(src), 2);
  });
});

describe('detectEdges + traceContours', () => {
  const W = 80;
  const H = 60;
  // A bright filled rectangle on black.
  const rect = (x: number, y: number) => (x >= 20 && x < 60 && y >= 15 && y < 45 ? 1 : 0);
  const tone = (() => {
    const t = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[y * W + x] = rect(x, y);
    return t;
  })();

  it('finds thin edges on the rectangle outline and nothing in the flat interior', () => {
    const edges = detectEdges(tone, W, H, 0.6);
    expect(edges[30 * W + 40]).toBe(0); // interior
    expect(edges[5 * W + 5]).toBe(0); // background
    // Somewhere along each side there is an edge pixel near the border.
    const hasEdgeNear = (x: number, y: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (edges[(y + dy) * W + x + dx] === 1) return true;
      return false;
    };
    expect(hasEdgeNear(40, 15)).toBe(true);
    expect(hasEdgeNear(40, 44)).toBe(true);
    expect(hasEdgeNear(20, 30)).toBe(true);
    expect(hasEdgeNear(59, 30)).toBe(true);
  });

  it('traces the outline into one long closed-ish stroke rather than fragments', () => {
    const edges = detectEdges(tone, W, H, 0.6);
    const strokes = traceContours(edges, W, H, 12);
    expect(strokes.length).toBeGreaterThanOrEqual(1);
    expect(strokes.length).toBeLessThanOrEqual(4);
    const longest = Math.max(...strokes.map((s) => s.length));
    expect(longest).toBeGreaterThan(80); // perimeter is 140px
    // Simplification: a rectangle needs only a handful of vertices.
    const biggest = strokes.find((s) => s.length === longest)!;
    expect(biggest.points.length).toBeLessThan(30);
  });

  it('drops strokes shorter than the minimum length', () => {
    const edges = new Uint8Array(30 * 30);
    for (let x = 5; x < 10; x++) edges[10 * 30 + x] = 1; // a 5px speck
    expect(traceContours(edges, 30, 30, 12)).toHaveLength(0);
    expect(traceContours(edges, 30, 30, 3).length).toBe(1);
  });

  it('flat and low-contrast noise produce no edges (no maze)', () => {
    const flat = new Float32Array(W * H).fill(0.5);
    expect(detectEdges(flat, W, H, 1).some((v) => v === 1)).toBe(false);

    const noise = new Float32Array(W * H);
    let seed = 7;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = 0.5 + ((seed / 0xffffffff) - 0.5) * 0.03; // +/-1.5% noise
    }
    expect(detectEdges(noise, W, H, 1).some((v) => v === 1)).toBe(false);
  });
});

describe('polyline helpers', () => {
  it('simplifyPolyline removes collinear points but keeps corners', () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(simplifyPolyline(line, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });

  it('smoothPolyline pins endpoints and softens corners', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const out = smoothPolyline(pts, 1);
    expect(out[0]).toEqual(pts[0]);
    expect(out[2]).toEqual(pts[2]);
    expect(out[1]!.x).toBeLessThan(10);
  });
});

describe('buildHatching', () => {
  const W = 60;
  const H = 60;
  const half = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) half[y * W + x] = x < 30 ? 0.02 : 0.95; // dark left, light right

  it('is off at shading 0', () => {
    expect(buildHatching(half, W, H, 0)).toHaveLength(0);
  });

  it('hatches the dark half only', () => {
    const strokes = buildHatching(half, W, H, 0.6);
    expect(strokes.length).toBeGreaterThan(5);
    for (const s of strokes) {
      expect(s.a.x).toBeLessThan(32);
      expect(s.b.x).toBeLessThan(32);
    }
  });

  it('uses more levels (crossing directions) in deeper shadow', () => {
    const levels = new Set(buildHatching(half, W, H, 1).map((s) => s.level));
    expect(levels.has(0)).toBe(true);
    expect(levels.has(1)).toBe(true);
  });
});
