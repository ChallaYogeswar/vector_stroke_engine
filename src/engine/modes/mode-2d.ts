import type { ModeEngine, RenderContext, RasterPayload } from '../types';
import { clamp } from '../math';

// ---------------------------------------------------------------------------
// Mode2D — "flat, clean vector-style render" (build-spec 3.2 #1).
//
// This is the foundation mode: its job is to prove the pipeline
// (upload -> preprocess -> mode -> render -> canvas) end to end before
// Sketch's edge-detection + timeline machinery gets built on top of it.
//
// process(): posterizes the cleaned image (quantizes each channel to a
// small number of levels) — cheap, deterministic, and it's what actually
// gives a photo the "flat vector" look this mode is named for, as opposed
// to just redisplaying the cleaned photo unchanged.
//
// render(): the posterized ImageData gets baked onto an offscreen canvas
// once (cached until the next process() call) and scaled-to-fit into
// whatever canvas the caller hands over, preserving aspect ratio.
// ---------------------------------------------------------------------------

export interface Mode2DOptions {
  /** Number of quantization levels per channel — see posterize(). */
  posterizeLevels: number;
}

export const DEFAULT_MODE2D_OPTIONS: Mode2DOptions = { posterizeLevels: 6 };
export const MODE2D_POSTERIZE_LEVELS_RANGE = { min: 2, max: 12 } as const;

export class Mode2D implements ModeEngine {
  readonly id = '2d' as const;

  private payload: RasterPayload | null = null;
  private offscreen: HTMLCanvasElement | null = null;
  private options: Mode2DOptions = { ...DEFAULT_MODE2D_OPTIONS };

  /**
   * docs/controls-spec.md section 3.1: not part of the shared ModeEngine interface
   * (build-spec section 5 locks process/render/reset — this is additive, not
   * a widening of that contract). useEngine.ts holds a typed ref to this
   * instance so it can call this directly, then re-triggers process() via
   * Controller.switchTo() to apply the change.
   */
  configure(options: Partial<Mode2DOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      posterizeLevels: clamp(
        Math.round(options.posterizeLevels ?? this.options.posterizeLevels),
        MODE2D_POSTERIZE_LEVELS_RANGE.min,
        MODE2D_POSTERIZE_LEVELS_RANGE.max,
      ),
    };
  }

  process(image: ImageData): RasterPayload {
    const stylized = posterize(image, this.options.posterizeLevels);
    this.payload = { kind: 'raster', imageData: stylized };
    this.offscreen = null; // invalidated; rebuilt lazily on next render()
    return this.payload;
  }

  render(renderCtx: RenderContext, _progress: number): void {
    if (!this.payload) return;

    if (!this.offscreen) {
      this.offscreen = imageDataToCanvas(this.payload.imageData);
    }

    renderCtx.ctx.clearRect(0, 0, renderCtx.width, renderCtx.height);
    drawContained(renderCtx.ctx, this.offscreen, renderCtx.width, renderCtx.height);
  }

  reset(): void {
    this.payload = null;
    this.offscreen = null;
  }
}

function posterize(image: ImageData, levels: number): ImageData {
  const step = 255 / (levels - 1);
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);

  for (let i = 0; i < src.length; i += 4) {
    out[i] = Math.round(Math.round(src[i]! / step) * step);
    out[i + 1] = Math.round(Math.round(src[i + 1]! / step) * step);
    out[i + 2] = Math.round(Math.round(src[i + 2]! / step) * step);
    out[i + 3] = src[i + 3]!;
  }

  return new ImageData(out, image.width, image.height);
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Mode2D: unable to acquire a 2D context for the offscreen canvas.');
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  targetW: number,
  targetH: number,
): void {
  const scale = Math.min(targetW / source.width, targetH / source.height);
  const drawW = source.width * scale;
  const drawH = source.height * scale;
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;
  ctx.drawImage(source, dx, dy, drawW, drawH);
}
