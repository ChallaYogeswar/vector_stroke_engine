// ---------------------------------------------------------------------------
// Locked data contracts — docs/build-spec.md section 5.
// Do not change these shapes casually: every mode engine is written against
// them, and the whole point of this rebuild is that a shape mismatch is a
// compiler error, not a runtime crash discovered three files away.
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Layer {
  name: string;
  stroke: string;
  points: Point[];
}

export interface ImageMeta {
  width: number;
  height: number;
  totalPoints: number;
  layers: number;
}

export interface StrokeData {
  meta: ImageMeta;
  layers: Layer[];
}

/**
 * The five modes. Kept as a standalone union (rather than only living on
 * ModeEngine['id']) so it can be imported anywhere — UI mode switcher,
 * Controller's registry keys, theme lookup — without reaching into a class.
 */
export type ModeId = 'sketch' | '2d' | '3d' | 'histogram' | 'ascii';

/**
 * What a mode hands the renderer when its output isn't stroke/path data.
 * Raster modes (2D in its Phase 1 form, and histogram/ASCII/3D after) return
 * one of these instead of a StrokeData. `kind` is the discriminant.
 *
 * Each phase added its own variant rather than overloading an existing one
 * for data that doesn't fit it: `RasterPayload` (Phase 1, Mode2D) is pixels,
 * `HistogramPayload` (Phase 3) is per-channel bucket counts, `AsciiPayload`
 * (Phase 4) is a character grid, `Relief3DPayload` (Phase 5) is a height +
 * color grid for the WebGL mesh. All five modes are real as of Phase 5, so
 * the placeholder variant that used to stand in for ASCII/3D is gone.
 */
export type RenderPayload = RasterPayload | HistogramPayload | AsciiPayload | Relief3DPayload;

export interface RasterPayload {
  kind: 'raster';
  imageData: ImageData;
}

/**
 * Per-channel pixel-value distributions, 256 buckets (0-255) each.
 * `maxCount` is the largest single bucket value across all four channels —
 * a convenience for the renderer so it normalizes bar/line heights against
 * one shared scale instead of each channel independently.
 */
export interface HistogramBins {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  maxCount: number;
}

export interface HistogramPayload {
  kind: 'histogram';
  bins: HistogramBins;
}

/**
 * Character-art grid (Phase 4, ModeASCII). `chars` is row-major, length
 * `cols * rows`; each entry is a single glyph from the ink-density ramp
 * (`' '` = background, densest glyph = brightest source luminance).
 */
export interface AsciiPayload {
  kind: 'ascii';
  cols: number;
  rows: number;
  chars: string[];
}

/**
 * Height + color grid feeding the WebGL relief mesh (Phase 5, Mode3D).
 * Row-major, length `cols * rows` for both arrays. `heights` is normalized
 * 0..1 (min-max over the source image, so relief depth reads consistently
 * regardless of the photo's own luminance range); `colors` is one
 * `#rrggbb` string per cell, sampled from the same region of the source.
 */
export interface Relief3DPayload {
  kind: 'relief3d';
  cols: number;
  rows: number;
  heights: number[];
  colors: string[];
}

/**
 * Everything a mode's render() needs, without owning the canvas itself.
 * `ctx` is 2D-only — every one of the five modes draws on
 * CanvasRenderingContext2D, including Mode3D. The Phase 0-3 comment here
 * used to say Mode3D would widen this into a union once it needed WebGL;
 * it doesn't, on purpose (see mode-3d.ts's header comment) — it renders its
 * Three.js scene to its own offscreen canvas and blits the result onto
 * `ctx` with drawImage(), so this type and every other mode stay untouched
 * by Phase 5 rather than all four having to narrow a widened union.
 */
export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/**
 * Every mode implements this — no more guessing method names.
 *
 * - process()  turns cleaned ImageData into whatever the mode renders from.
 *              Called once per image load / mode switch, not per frame.
 * - render()   draws one frame. progress is 0..1, driven by Timeline; modes
 *              that don't animate (2D, histogram) can just ignore it.
 * - reset()    clears any internal state so the engine can be reused for a
 *              new image without leaking the old one.
 */
export interface ModeEngine {
  readonly id: ModeId;
  process(image: ImageData): StrokeData | RenderPayload;
  render(ctx: RenderContext, progress: number): void;
  reset(): void;
}
