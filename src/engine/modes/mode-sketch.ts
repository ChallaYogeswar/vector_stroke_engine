import type { ModeEngine, StrokeData, RenderContext, Layer, Point, ImageMeta } from '../types';
import { clamp } from '../math';
import { readThemeColors, withAlpha } from '../theme';

// ---------------------------------------------------------------------------
// Sketch — "animated hand-drawn stroke reveal", the flagship mode
// (build-spec 3.2 #2). Pipeline, exactly as specced:
//
//   Sobel edge detection -> point extraction -> nearest-neighbor path
//   ordering -> timeline-driven stroke-by-stroke animation.
//
// process() (runs once per upload/mode-switch, not per frame):
//   1. Grayscale luminance (same Rec.709 weights cleanup.ts uses).
//   2. Sobel gradient magnitude per pixel.
//   3. Percentile threshold on the magnitude histogram — this adapts to the
//      image instead of a fixed brightness cutoff, so a low-contrast photo
//      still yields a usable edge set and a high-contrast one doesn't flood
//      it.
//   4. Grid-bucketed sampling: the image is divided into cells sized so the
//      cell count lands near POINT_BUDGET; each cell contributes at most its
//      single strongest qualifying edge pixel. This bounds total points
//      predictably regardless of image content (unlike thresholding alone,
//      which can return anywhere from 0 to width*height points).
//   5. Greedy nearest-neighbor walk turns the point cloud into ordered
//      paths: repeatedly step to the closest unvisited point; a jump farther
//      than maxJump ends the stroke (pen lift) rather than drawing a long
//      line across unrelated image regions. Each resulting path is one
//      `Layer` — i.e. `Layer` here means "one continuous pen stroke", not a
//      semantic image layer, matching the `stroke` field's role as that
//      path's draw color.
//
// render() reveals strokes in point-order across the whole image using
// `progress` as a global budget: earlier (usually longer) strokes finish
// before later ones start, and the stroke currently being drawn gets a
// brighter "pen tip" glow.
// ---------------------------------------------------------------------------

const POINT_BUDGET = 2200;
const MIN_CELL_SIZE = 2;
const EDGE_PERCENTILE = 0.88; // keep roughly the strongest ~12% of gradient magnitudes as edge candidates
const MAX_JUMP_FACTOR = 2.75; // beyond this many cell-widths, a nearest-neighbor step is a pen lift, not a line
const MIN_STROKE_POINTS = 2; // isolated single points (nothing nearby within maxJump) are dropped, not drawn as dots
const LONG_STROKE_POINTS = 6; // strokes at/above this length draw in the bolder accent-strong; shorter ones are lighter detail
const DEFAULT_STROKE_WIDTH = 1.4;

export interface SketchOptions {
  /** Percentile cutoff on Sobel gradient magnitude — lower keeps more (denser) edges. */
  edgePercentile: number;
  /** Target total point count across all strokes; the O(n) spatial-grid path ordering (see below) is what makes raising this safe. */
  pointBudget: number;
  /** Canvas lineWidth for stroke rendering. */
  strokeWidth: number;
}

export const DEFAULT_SKETCH_OPTIONS: SketchOptions = {
  edgePercentile: EDGE_PERCENTILE,
  pointBudget: POINT_BUDGET,
  strokeWidth: DEFAULT_STROKE_WIDTH,
};

export const SKETCH_EDGE_PERCENTILE_RANGE = { min: 0.7, max: 0.97 } as const;
export const SKETCH_POINT_BUDGET_RANGE = { min: 500, max: 8000 } as const;
export const SKETCH_STROKE_WIDTH_RANGE = { min: 0.5, max: 3 } as const;

export class ModeSketch implements ModeEngine {
  readonly id = 'sketch' as const;

  private data: StrokeData | null = null;
  private options: SketchOptions = { ...DEFAULT_SKETCH_OPTIONS };

  /** See docs/controls-spec.md section 3.1 — additive, not part of the locked ModeEngine interface. */
  configure(options: Partial<SketchOptions>): void {
    this.options = {
      edgePercentile: clamp(
        options.edgePercentile ?? this.options.edgePercentile,
        SKETCH_EDGE_PERCENTILE_RANGE.min,
        SKETCH_EDGE_PERCENTILE_RANGE.max,
      ),
      pointBudget: clamp(
        Math.round(options.pointBudget ?? this.options.pointBudget),
        SKETCH_POINT_BUDGET_RANGE.min,
        SKETCH_POINT_BUDGET_RANGE.max,
      ),
      strokeWidth: clamp(
        options.strokeWidth ?? this.options.strokeWidth,
        SKETCH_STROKE_WIDTH_RANGE.min,
        SKETCH_STROKE_WIDTH_RANGE.max,
      ),
    };
  }

  process(image: ImageData): StrokeData {
    const { width, height } = image;
    const luminance = toLuminance(image);
    const magnitude = sobelMagnitude(luminance, width, height);
    const threshold = percentileThreshold(magnitude, this.options.edgePercentile);

    const cellSize = Math.max(MIN_CELL_SIZE, Math.round(Math.sqrt((width * height) / this.options.pointBudget)));
    const points = sampleEdgePoints(magnitude, width, height, threshold, cellSize);
    const paths = orderIntoPaths(points, cellSize * MAX_JUMP_FACTOR);

    const theme = readThemeColors();
    const layers: Layer[] = paths
      .filter((path) => path.length >= MIN_STROKE_POINTS)
      .map((path, i) => ({
        name: `Stroke ${i + 1}`,
        stroke: path.length >= LONG_STROKE_POINTS ? theme.accentStrong : withAlpha(theme.accent, 0.6),
        points: path,
      }));

    const totalPoints = layers.reduce((sum, layer) => sum + layer.points.length, 0);
    const meta: ImageMeta = { width, height, totalPoints, layers: layers.length };

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
    if (progress > 0 && budget === 0) budget = 1; // don't sit blank for the animation's first frame

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const layer of layers) {
      if (budget <= 0) break;
      const count = Math.min(layer.points.length, budget);
      budget -= count;
      if (count < 1) continue;
      drawStroke(ctx, layer, count, scale, offsetX, offsetY, count === layer.points.length, this.options.strokeWidth);
    }

    ctx.restore();
  }

  reset(): void {
    this.data = null;
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function drawStroke(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  count: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  isComplete: boolean,
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
    ctx.shadowBlur = isComplete ? 1.5 : 6;
    ctx.stroke();
  }

  // Pen-tip cue at the leading point of a stroke still being drawn — the
  // "strokes read as light/glowing lines on near-black" effect from
  // build-spec section 6, concentrated at the point currently being placed.
  if (!isComplete) {
    const tip = toCanvas(layer.points[count - 1]!);
    ctx.beginPath();
    ctx.fillStyle = layer.stroke;
    ctx.shadowBlur = 8;
    ctx.arc(tip.x, tip.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

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

// ---------------------------------------------------------------------------
// Luminance + Sobel
// ---------------------------------------------------------------------------

function toLuminance(image: ImageData): Float32Array {
  const { width, height, data } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  }
  return out;
}

function sobelMagnitude(luminance: Float32Array, width: number, height: number): Float32Array {
  const magnitude = new Float32Array(width * height);

  const at = (x: number, y: number): number => {
    const cx = clamp(x, 0, width - 1);
    const cy = clamp(y, 0, height - 1);
    return luminance[cy * width + cx]!;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const gx = -tl + tr - 2 * l + 2 * r - bl + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;

      magnitude[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  return magnitude;
}

/** Returns the magnitude value at which roughly `1 - percentile` of pixels sit at or above it (via a 256-bucket histogram over the observed magnitude range). */
function percentileThreshold(magnitude: Float32Array, percentile: number): number {
  let max = 0;
  for (const m of magnitude) if (m > max) max = m;
  if (max <= 0) return 0;

  const bins = 256;
  const scale = (bins - 1) / max;
  const hist = new Uint32Array(bins);
  for (const m of magnitude) hist[Math.min(bins - 1, Math.floor(m * scale))]!++;

  const targetCount = magnitude.length * (1 - percentile);
  let cumulative = 0;
  for (let b = bins - 1; b >= 0; b--) {
    cumulative += hist[b]!;
    if (cumulative >= targetCount) return b / scale;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Point extraction — one strongest-qualifying point per grid cell.
// ---------------------------------------------------------------------------

function sampleEdgePoints(
  magnitude: Float32Array,
  width: number,
  height: number,
  threshold: number,
  cellSize: number,
): Point[] {
  const points: Point[] = [];

  for (let cellY = 0; cellY < height; cellY += cellSize) {
    const yEnd = Math.min(height, cellY + cellSize);
    for (let cellX = 0; cellX < width; cellX += cellSize) {
      const xEnd = Math.min(width, cellX + cellSize);

      let bestVal = threshold;
      let bestX = -1;
      let bestY = -1;
      for (let y = cellY; y < yEnd; y++) {
        for (let x = cellX; x < xEnd; x++) {
          const v = magnitude[y * width + x]!;
          if (v > bestVal) {
            bestVal = v;
            bestX = x;
            bestY = y;
          }
        }
      }
      if (bestX >= 0) points.push({ x: bestX, y: bestY });
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Nearest-neighbor path ordering — 2D spatial hash grid.
//
// This used to be a plain O(n^2) scan, deliberately left that way while
// POINT_BUDGET was a fixed constant (a few thousand points, sub-200ms even
// unindexed). docs/controls-spec.md turns POINT_BUDGET into a user-facing slider,
// which invalidates that premise — at 8,000-10,000 points the same O(n^2)
// walk runs into noticeable multi-hundred-ms stalls, right when a user is
// dragging a slider and expects the preview to keep up.
//
// The walk only ever needs the nearest *unvisited* point within `maxJump`
// of the current one — anything farther ends the stroke regardless (see the
// maxJumpSq check below, unchanged from the original). That's what makes a
// uniform grid an exact replacement rather than an approximation: with cell
// size == maxJump, any point within Euclidean distance maxJump of a query
// point falls in that point's own grid cell or one of its 8 neighbors — a
// query point can sit anywhere inside its cell, so an offset of up to
// maxJump in any direction reaches at most one full cell further in that
// direction (proof: worst case the query point sits at its cell's near
// edge; maxJump beyond the cell's *far* edge lands exactly one cell over,
// never two). So a 3x3 neighborhood scan is guaranteed to find every
// candidate the exhaustive version would have found. If the true nearest
// point is farther than maxJump, the 3x3 scan may still turn up *something*
// (a farther point sharing the neighborhood) — the explicit maxJumpSq
// recheck after the grid query catches that case and lifts the pen exactly
// like the original code did.
//
// Visited points are removed from the grid the moment they're chosen, so
// the grid always holds exactly the remaining unvisited points and every
// query is a plain "nearest point in the grid," no visited-flag checking
// needed inside the hot loop.
// ---------------------------------------------------------------------------

interface SpatialGrid {
  /** Removes a point (by its index into the original `points` array) so future queries never return it again. */
  remove(pointIdx: number): void;
  /** Nearest remaining point to `from`, searching only the 3x3 cell neighborhood — see header comment for why that's exact, not approximate, given cellSize === maxJump. Returns -1 if that neighborhood is empty. */
  nearestRemaining(from: Point): number;
}

function buildSpatialGrid(points: Point[], cellSize: number): SpatialGrid {
  // Guard against a degenerate (zero/negative) cell size — cellSize is
  // always MAX_JUMP_FACTOR times a positive sampling cell size in practice,
  // but a defensive floor keeps this function correct standalone too.
  const cell = cellSize > 0 ? cellSize : 1;
  const keyOf = (gx: number, gy: number): string => `${gx},${gy}`;
  const cellXOf = (p: Point): number => Math.floor(p.x / cell);
  const cellYOf = (p: Point): number => Math.floor(p.y / cell);

  const buckets = new Map<string, number[]>();
  const bucketKeyByIdx = new Array<string>(points.length);

  for (let i = 0; i < points.length; i++) {
    const key = keyOf(cellXOf(points[i]!), cellYOf(points[i]!));
    bucketKeyByIdx[i] = key;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(i);
  }

  function remove(pointIdx: number): void {
    const key = bucketKeyByIdx[pointIdx]!;
    const bucket = buckets.get(key);
    if (!bucket) return;
    const pos = bucket.indexOf(pointIdx);
    if (pos === -1) return;
    // Swap-pop: bucket order is never meaningful, so this is O(1) instead
    // of an O(bucket length) splice.
    bucket[pos] = bucket[bucket.length - 1]!;
    bucket.pop();
  }

  function nearestRemaining(from: Point): number {
    const fx = cellXOf(from);
    const fy = cellYOf(from);
    let bestIdx = -1;
    let bestDistSq = Infinity;

    for (let gy = fy - 1; gy <= fy + 1; gy++) {
      for (let gx = fx - 1; gx <= fx + 1; gx++) {
        const bucket = buckets.get(keyOf(gx, gy));
        if (!bucket) continue;
        for (const idx of bucket) {
          const dx = points[idx]!.x - from.x;
          const dy = points[idx]!.y - from.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = idx;
          }
        }
      }
    }
    return bestIdx;
  }

  return { remove, nearestRemaining };
}

/**
 * Exported for direct correctness testing (see engine.test.ts): the grid
 * rewrite is cross-checked against a brute-force reference on randomized
 * point sets rather than only exercised indirectly through process().
 */
export function orderIntoPaths(points: Point[], maxJump: number): Point[][] {
  const n = points.length;
  if (n === 0) return [];

  const visited = new Uint8Array(n);
  const paths: Point[][] = [];
  const maxJumpSq = maxJump * maxJump;
  const grid = buildSpatialGrid(points, maxJump);

  // Monotonic scan cursor for finding each new path's start: every index
  // becomes visited exactly once for the rest of the run, so a cursor that
  // only ever moves forward finds all path starts in amortized O(n) total
  // across the whole call, rather than up to O(n) *per path* (the original
  // reset this to `startIdx` after every path, which could re-scan the same
  // stretch of already-visited indices from multiple different starts).
  let scanPos = 0;
  const findNextUnvisited = (): number => {
    while (scanPos < n && visited[scanPos]) scanPos++;
    return scanPos < n ? scanPos : -1;
  };

  for (;;) {
    const startIdx = findNextUnvisited();
    if (startIdx === -1) break;

    visited[startIdx] = 1;
    grid.remove(startIdx);
    let current = points[startIdx]!;
    const path: Point[] = [current];

    for (;;) {
      const bestIdx = grid.nearestRemaining(current);
      if (bestIdx === -1) break;

      const dx = points[bestIdx]!.x - current.x;
      const dy = points[bestIdx]!.y - current.y;
      if (dx * dx + dy * dy > maxJumpSq) break;

      visited[bestIdx] = 1;
      grid.remove(bestIdx);
      current = points[bestIdx]!;
      path.push(current);
    }

    paths.push(path);
  }

  return paths;
}
