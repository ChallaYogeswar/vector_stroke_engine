import type { Point } from '../types';
import { clamp } from '../math';

// ---------------------------------------------------------------------------
// Sketch tracing — the pure algorithms behind ModeSketch (no canvas, no theme).
//
//   ImageData
//     -> buildToneMap()   working-size luminance, auto-levelled so a dark or
//                          washed-out photo still has usable contrast
//     -> detectEdges()    Gaussian blur -> Sobel -> non-maximum suppression ->
//                          hysteresis threshold (the Canny recipe): thin,
//                          connected edge pixels, not scattered noise
//     -> traceContours()  walk connected edge pixels into ordered polylines,
//                          smooth + simplify them into clean pen strokes
//     -> buildHatching()  optional pen shading: parallel hatch lines wherever
//                          the tone is dark (two crossing directions in the
//                          deepest shadows)
//
// Everything here works in a "working space" (long edge <= WORKING_MAX_DIM),
// and results are scaled back to source-image coordinates by the caller via
// the sx/sy factors on the ToneMap. Working at a bounded size keeps the cost
// flat no matter how large the upload is, and smooths away sensor noise that
// would otherwise be traced as squiggles.
// ---------------------------------------------------------------------------

export const WORKING_MAX_DIM = 720;

export interface ToneMap {
  width: number;
  height: number;
  /** Source pixels per working pixel, per axis (>= 1). */
  sx: number;
  sy: number;
  /** Auto-levelled luminance in 0..1 (0 = black), working size, un-blurred. */
  tone: Float32Array;
}

// ------------------------------- tone map -----------------------------------

export function buildToneMap(image: ImageData, maxDim: number = WORKING_MAX_DIM): ToneMap {
  const { width: srcW, height: srcH, data } = image;
  const factor = Math.max(1, Math.max(srcW, srcH) / maxDim);
  const width = Math.max(1, Math.round(srcW / factor));
  const height = Math.max(1, Math.round(srcH / factor));
  const sx = srcW / width;
  const sy = srcH / height;

  // Area-average downscale of Rec.709 luminance.
  const lum = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.min(srcH - 1, Math.floor(y * sy));
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(srcW - 1, Math.floor(x * sx));
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * srcW + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          n++;
        }
      }
      lum[y * width + x] = sum / n;
    }
  }

  return { width, height, sx, sy, tone: autoLevel(lum) };
}

/**
 * Stretches the 1st..99th percentile to 0..1, then applies a gamma that moves
 * the median to mid-grey. This is what makes a dark, underexposed photo (most
 * of its pixels crushed near black) yield the same quality of edges/shading
 * as a well-exposed one.
 */
function autoLevel(lum: Float32Array): Float32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.min(255, Math.max(0, Math.round(lum[i]!)))]!++;

  const percentile = (p: number): number => {
    const target = p * lum.length;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= target) return v;
    }
    return 255;
  };

  const lo = percentile(0.01);
  const hiRaw = percentile(0.99);
  const out = new Float32Array(lum.length);
  if (hiRaw - lo < 8) {
    // Essentially no contrast to stretch (a flat grey / white / black frame):
    // keep true brightness so a white page isn't mistaken for shadow.
    for (let i = 0; i < lum.length; i++) out[i] = clamp(lum[i]! / 255, 0, 1);
    return out;
  }
  for (let i = 0; i < lum.length; i++) out[i] = clamp((lum[i]! - lo) / (hiRaw - lo), 0, 1);

  // Median of the stretched values -> gamma putting it at 0.5.
  const sorted = Float32Array.from(out).sort();
  const median = clamp(sorted[Math.floor(sorted.length / 2)] ?? 0.5, 0.02, 0.98);
  const gamma = clamp(Math.log(0.5) / Math.log(median), 0.4, 1.6);
  if (Math.abs(gamma - 1) > 0.02) for (let i = 0; i < out.length; i++) out[i] = Math.pow(out[i]!, gamma);
  return out;
}

// ------------------------------- blur ---------------------------------------

/** Separable Gaussian blur (edges clamped). */
export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return Float32Array.from(src);
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    total += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total;

  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k;
        acc += src[row + xx]! * kernel[k + radius]!;
      }
      tmp[row + x] = acc;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k;
        acc += tmp[yy * width + x]! * kernel[k + radius]!;
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

// ------------------------------- edges --------------------------------------

/** Edges weaker than this (normalised gradient, 1 = black-to-white step) are never drawn. */
const MIN_STRONG_EDGE = 0.07;
const LOW_TO_HIGH_RATIO = 0.42;
export const EDGE_BLUR_SIGMA = 1.3;

/**
 * Canny-style edge map. `sensitivity` (0..1) controls how much of the edge
 * structure survives: higher = more (finer) edges. Returns 1 for edge pixels.
 */
export function detectEdges(tone: Float32Array, width: number, height: number, sensitivity: number): Uint8Array {
  const edges = new Uint8Array(width * height);
  if (width < 3 || height < 3) return edges;

  const blurred = gaussianBlur(tone, width, height, EDGE_BLUR_SIGMA);
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = blurred[i - width - 1]!, t = blurred[i - width]!, tr = blurred[i - width + 1]!;
      const l = blurred[i - 1]!, r = blurred[i + 1]!;
      const bl = blurred[i + width - 1]!, b = blurred[i + width]!, br = blurred[i + width + 1]!;
      const dx = (-tl + tr - 2 * l + 2 * r - bl + br) / 4;
      const dy = (-tl - 2 * t - tr + bl + 2 * b + br) / 4;
      gx[i] = dx;
      gy[i] = dy;
      mag[i] = Math.sqrt(dx * dx + dy * dy);
    }
  }

  // Non-maximum suppression: keep a pixel only if it is the local maximum
  // across the edge (along the gradient direction) -> 1px-thin ridges.
  const nms = new Float32Array(width * height);
  const values: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i]!;
      if (m < 0.02) continue;
      const ax = Math.abs(gx[i]!);
      const ay = Math.abs(gy[i]!);
      let a: number;
      let b: number;
      if (ay <= ax * 0.4142) {
        a = mag[i - 1]!; b = mag[i + 1]!; // gradient ~horizontal
      } else if (ay >= ax * 2.4142) {
        a = mag[i - width]!; b = mag[i + width]!; // ~vertical
      } else if (gx[i]! * gy[i]! > 0) {
        a = mag[i - width - 1]!; b = mag[i + width + 1]!; // ~diagonal "\"
      } else {
        a = mag[i - width + 1]!; b = mag[i + width - 1]!; // ~diagonal "/"
      }
      if (m >= a && m >= b) {
        nms[i] = m;
        values.push(m);
      }
    }
  }
  if (values.length === 0) return edges;

  // Hysteresis thresholds adapt to the image: keep the strongest `keep`
  // fraction of ridge pixels as "sure" edges, with a floor so flat/noisy
  // images produce nothing instead of a maze.
  values.sort((p, q) => p - q);
  const keep = 0.08 + 0.42 * clamp(sensitivity, 0, 1);
  const highPct = values[Math.min(values.length - 1, Math.floor(values.length * (1 - keep)))]!;
  const high = Math.max(highPct, MIN_STRONG_EDGE);
  const low = high * LOW_TO_HIGH_RATIO;

  const stack: number[] = [];
  for (let i = 0; i < nms.length; i++) {
    if (nms[i]! >= high) {
      edges[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (edges[j] === 0 && nms[j]! >= low) {
          edges[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return edges;
}

// ------------------------------ contours ------------------------------------

export interface TracedStroke {
  /** Points in WORKING space (floats). */
  points: Point[];
  /** Approximate length in working pixels (before simplification). */
  length: number;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], // 4-connected first: preferred on ties
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

/**
 * Turns a 1px edge map into smooth polylines. Chains shorter than
 * `minLength` working pixels (specks, hairs of noise) are dropped.
 */
export function traceContours(edges: Uint8Array, width: number, height: number, minLength: number): TracedStroke[] {
  const visited = new Uint8Array(width * height);

  const degree = (i: number): number => {
    const x = i % width;
    const y = (i - x) / width;
    let n = 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && edges[ny * width + nx] === 1) n++;
    }
    return n;
  };

  /** Follows the edge from `start` (already marked visited), preferring to keep going straight. */
  const walk = (start: number): number[] => {
    const chain = [start];
    let cur = start;
    let pdx = 0;
    let pdy = 0;
    for (;;) {
      const x = cur % width;
      const y = (cur - x) / width;
      let best = -1;
      let bestScore = -Infinity;
      let bdx = 0;
      let bdy = 0;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (edges[j] !== 1 || visited[j] === 1) continue;
        const stepLen = Math.hypot(dx, dy);
        // Straightness (cosine with previous heading) dominates; the small
        // 4-connected bonus keeps the walk off 1px staircase diagonals.
        const score = (pdx === 0 && pdy === 0 ? 0 : (dx * pdx + dy * pdy) / (stepLen * Math.hypot(pdx, pdy))) + (stepLen === 1 ? 0.05 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = j;
          bdx = dx;
          bdy = dy;
        }
      }
      if (best < 0) break;
      visited[best] = 1;
      chain.push(best);
      cur = best;
      pdx = bdx;
      pdy = bdy;
    }
    return chain;
  };

  const chains: number[][] = [];
  const begin = (i: number, isEndpoint: boolean): void => {
    visited[i] = 1;
    const forward = walk(i);
    if (isEndpoint) {
      chains.push(forward);
      return;
    }
    // Started mid-curve (a loop or a leftover): also walk the other way.
    const backward = walk(i);
    backward.shift(); // drop the duplicated start pixel
    backward.reverse();
    chains.push(backward.concat(forward));
  };

  // Pass 1: begin at endpoints so open curves come out as single strokes.
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] === 1 && visited[i] === 0 && degree(i) === 1) begin(i, true);
  }
  // Pass 2: whatever remains is loops / junction leftovers.
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] === 1 && visited[i] === 0) begin(i, false);
  }

  const strokes: TracedStroke[] = [];
  for (const chain of chains) {
    if (chain.length < minLength) continue;
    let pts: Point[] = chain.map((i) => {
      const x = i % width;
      return { x: x + 0.5, y: (i - x) / width + 0.5 };
    });
    pts = smoothPolyline(pts, 2);
    pts = simplifyPolyline(pts, 0.65);
    if (pts.length >= 2) strokes.push({ points: pts, length: chain.length });
  }
  return strokes;
}

/** [1 2 1]/4 smoothing, endpoints pinned. Removes the 1px staircase from traced pixels. */
export function smoothPolyline(points: Point[], passes: number): Point[] {
  let cur = points;
  for (let p = 0; p < passes; p++) {
    if (cur.length < 3) return cur;
    const next: Point[] = [cur[0]!];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1]!;
      const b = cur[i]!;
      const c = cur[i + 1]!;
      next.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

/** Ramer–Douglas–Peucker (iterative). */
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const a = points[s]!;
    const b = points[e]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let maxDist = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const p = points[i]!;
      const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push(points[i]!);
  return out;
}

// ------------------------------- hatching -----------------------------------

export interface HatchStroke {
  a: Point;
  b: Point;
  /** 0 = lightest shadow layer (45deg), 1 = deeper (-45deg), 2 = deepest (horizontal). */
  level: 0 | 1 | 2;
}

/**
 * Pen-style shading. Parallel lines are laid across the image; wherever the
 * (softly blurred) tone is darker than a level's threshold the line is drawn.
 * `shading` 0 disables it; higher values shade progressively lighter areas.
 */
export function buildHatching(tone: Float32Array, width: number, height: number, shading: number): HatchStroke[] {
  const s = clamp(shading, 0, 1);
  if (s <= 0.001) return [];

  const soft = gaussianBlur(tone, width, height, 2.2);
  const t0 = 0.18 + 0.32 * s; // lightest hatched tone
  const thresholds: [number, number, number] = [t0, t0 * 0.66, t0 * 0.36];
  const spacing = Math.max(4, Math.round(Math.max(width, height) / 105));
  const minRun = Math.max(4, spacing);
  const strokes: HatchStroke[] = [];

  const sample = (x: number, y: number): number => {
    const xi = Math.min(width - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(height - 1, Math.max(0, Math.round(y)));
    return soft[yi * width + xi]!;
  };

  // Directions as unit vectors; `offsets` enumerates parallel lines.
  const layers: Array<{ level: 0 | 1 | 2; dx: number; dy: number }> = [
    { level: 0, dx: Math.SQRT1_2, dy: Math.SQRT1_2 },
    { level: 1, dx: Math.SQRT1_2, dy: -Math.SQRT1_2 },
    { level: 2, dx: 1, dy: 0 },
  ];

  for (const { level, dx, dy } of layers) {
    const threshold = thresholds[level];
    // Perpendicular axis: n = (-dy, dx). Line k passes through points with n·p = k*spacing.
    const nx = -dy;
    const ny = dx;
    const corners = [0, width * nx, height * ny, width * nx + height * ny];
    const kMin = Math.floor(Math.min(...corners) / spacing);
    const kMax = Math.ceil(Math.max(...corners) / spacing);
    const spacingHere = level === 2 ? spacing * 1.5 : spacing;
    for (let k = kMin; k <= kMax; k++) {
      const offset = level === 2 ? k * spacingHere : k * spacing;
      // A point on the line, then step along (dx, dy) across the image bounds.
      const px = nx * offset;
      const py = ny * offset;
      const span = Math.hypot(width, height);
      let runStart: Point | null = null;
      let last: Point | null = null;
      for (let t = -span; t <= span; t += 1) {
        const x = px + dx * t;
        const y = py + dy * t;
        const inside = x >= 0 && y >= 0 && x < width && y < height;
        const dark = inside && sample(x, y) < threshold;
        if (dark) {
          if (!runStart) runStart = { x, y };
          last = { x, y };
        } else if (runStart && last) {
          if (Math.hypot(last.x - runStart.x, last.y - runStart.y) >= minRun) strokes.push({ a: runStart, b: last, level });
          runStart = null;
          last = null;
        }
      }
      if (runStart && last && Math.hypot(last.x - runStart.x, last.y - runStart.y) >= minRun) {
        strokes.push({ a: runStart, b: last, level });
      }
    }
  }
  return strokes;
}
