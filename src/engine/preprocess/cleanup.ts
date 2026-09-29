// ---------------------------------------------------------------------------
// Preprocessing / cleanup — docs/build-spec.md section 3.1.
//
// This is the "replaces the old, mislabeled 'without filters' mode" step:
// it is cleanup, not a display mode. It runs once per upload and every mode
// engine reads its output, never the raw upload.
//
// Pipeline order: denoise -> spot removal -> sharpen. Denoising first keeps
// the blemish detector from tripping on sensor noise; sharpening last so it
// enhances the retouched result instead of amplifying noise/blemish edges
// that get cleaned up in the earlier steps.
//
// All blur used below (unsharp mask's low-pass, and the "surrounding pixel"
// average used for inpainting) is a box blur built on a summed-area table
// (integral image). That makes blur cost independent of radius — one pass
// to build the table, O(1) per pixel to query any window size — which
// matters here because both sharpening and spot-removal need a blur pass
// over the full image. A true Gaussian kernel would look marginally
// smoother at large radii; box blur is the documented tradeoff for Phase 1.
// ---------------------------------------------------------------------------

import { clamp } from '../math';

export interface CleanupOptions {
  /** Median filter for sensor-noise reduction. */
  denoise: {
    enabled: boolean;
  };
  /** Small dark outlier regions get detected and inpainted. */
  spotRemoval: {
    enabled: boolean;
    /** Luminance units (0-255) a pixel must sit below its neighborhood to qualify as a spot candidate. */
    darknessThreshold: number;
    /** Radius (px) used to compute the "neighborhood" a pixel is compared against. */
    neighborhoodRadius: number;
    /** Connected regions larger than this (px) are treated as real content (hair, shadow), not a blemish. */
    maxSpotArea: number;
  };
  /** Unsharp mask for blur correction. */
  sharpen: {
    enabled: boolean;
    /** 0 = no effect, ~0.5-1.0 = typical, higher = more aggressive. */
    amount: number;
    radius: number;
  };
}

export const DEFAULT_CLEANUP_OPTIONS: CleanupOptions = {
  denoise: { enabled: true },
  spotRemoval: {
    enabled: true,
    darknessThreshold: 26,
    neighborhoodRadius: 6,
    maxSpotArea: 40,
  },
  sharpen: {
    enabled: true,
    amount: 0.6,
    radius: 2,
  },
};

/** Runs the full cleanup pipeline and returns a new ImageData (input is left untouched). */
export function cleanupImage(image: ImageData, options: CleanupOptions = DEFAULT_CLEANUP_OPTIONS): ImageData {
  let working = cloneImageData(image);

  if (options.denoise.enabled) {
    working = medianFilter3x3(working);
  }
  if (options.spotRemoval.enabled) {
    working = removeBlemishes(working, options.spotRemoval);
  }
  if (options.sharpen.enabled) {
    working = unsharpMask(working, options.sharpen.amount, options.sharpen.radius);
  }

  return working;
}

// ---------------------------------------------------------------------------
// Noise reduction — 3x3 median filter, per RGB channel. Alpha passes through
// unchanged (photos are opaque; median-filtering alpha buys nothing).
// ---------------------------------------------------------------------------

export function medianFilter3x3(image: ImageData): ImageData {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);

  const rWindow = new Uint8ClampedArray(9);
  const gWindow = new Uint8ClampedArray(9);
  const bWindow = new Uint8ClampedArray(9);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = clamp(y + dy, 0, height - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const sx = clamp(x + dx, 0, width - 1);
          const si = (sy * width + sx) * 4;
          rWindow[n] = data[si]!;
          gWindow[n] = data[si + 1]!;
          bWindow[n] = data[si + 2]!;
          n++;
        }
      }
      insertionSort9(rWindow);
      insertionSort9(gWindow);
      insertionSort9(bWindow);

      const di = (y * width + x) * 4;
      out[di] = rWindow[4]!;
      out[di + 1] = gWindow[4]!;
      out[di + 2] = bWindow[4]!;
      out[di + 3] = data[di + 3]!;
    }
  }

  return new ImageData(out, width, height);
}

/** Fixed-size insertion sort for a 9-element window — faster than Array.sort for this size. */
function insertionSort9(arr: Uint8ClampedArray): void {
  for (let i = 1; i < 9; i++) {
    const key = arr[i]!;
    let j = i - 1;
    while (j >= 0 && arr[j]! > key) {
      arr[j + 1] = arr[j]!;
      j--;
    }
    arr[j + 1] = key;
  }
}

// ---------------------------------------------------------------------------
// Spot / blemish removal.
//
// 1. Compute per-pixel luminance and its local (blurred) neighborhood mean.
// 2. Flag pixels sitting well below their neighborhood as spot candidates.
// 3. Connected-component the candidate mask; keep only small components
//    (a real blemish is a few px across — a cast shadow or dark hair is not).
// 4. Inpaint kept spots by replacing RGB with the local blurred RGB, i.e.
//    "surrounding pixels", per build-spec.
// ---------------------------------------------------------------------------

export function removeBlemishes(image: ImageData, options: CleanupOptions['spotRemoval']): ImageData {
  const { width, height, data } = image;
  const pixelCount = width * height;

  const luminance = new Float64Array(pixelCount);
  const r = new Float64Array(pixelCount);
  const g = new Float64Array(pixelCount);
  const b = new Float64Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const di = i * 4;
    const rv = data[di]!;
    const gv = data[di + 1]!;
    const bv = data[di + 2]!;
    r[i] = rv;
    g[i] = gv;
    b[i] = bv;
    luminance[i] = 0.2126 * rv + 0.7152 * gv + 0.0722 * bv;
  }

  const radius = options.neighborhoodRadius;
  const localLuminance = boxBlurChannel(luminance, width, height, radius);
  const localR = boxBlurChannel(r, width, height, radius);
  const localG = boxBlurChannel(g, width, height, radius);
  const localB = boxBlurChannel(b, width, height, radius);

  const candidate = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    candidate[i] = localLuminance[i]! - luminance[i]! > options.darknessThreshold ? 1 : 0;
  }

  const spotMask = keepSmallComponents(candidate, width, height, options.maxSpotArea);

  const out = new Uint8ClampedArray(data.length);
  out.set(data);
  for (let i = 0; i < pixelCount; i++) {
    if (spotMask[i]) {
      const di = i * 4;
      out[di] = clamp(Math.round(localR[i]!), 0, 255);
      out[di + 1] = clamp(Math.round(localG[i]!), 0, 255);
      out[di + 2] = clamp(Math.round(localB[i]!), 0, 255);
      // alpha untouched
    }
  }

  return new ImageData(out, width, height);
}

/**
 * 4-connected component labeling; returns a mask with only components of
 * size <= maxArea kept.
 *
 * Exported for direct unit testing (see engine.test.ts) — this is the one
 * piece of the spot-removal pass worth testing in isolation from the
 * blur/threshold machinery around it, the same way clamp/boxBlurChannel
 * already are.
 *
 * An earlier version of this function `break`'d out of the inner walk once
 * `component.length > maxArea * 4`, as a shortcut to avoid pixel-by-pixel
 * traversal of e.g. a whole shadowed background. That shortcut was wrong:
 * breaking out of the `while` loop abandons the stack mid-walk, so any
 * candidate pixels not yet *discovered* (only pixels already pushed get
 * marked `visited`) are left unvisited. The outer loop then finds one of
 * those leftover pixels on a later iteration and starts a *new* component
 * search from it — one that only rediscovers whatever fragment of the same
 * real region is still unvisited, walled in by the `visited` pixels from
 * the first pass. If that fragment happens to be <= maxArea, it gets kept
 * (and later inpainted) as a "blemish" even though it's part of a much
 * larger region — exactly the false-positive artifacting seen on dark hair
 * and shadow edges.
 *
 * The fix keeps the spirit of the original shortcut (don't bother
 * *remembering* every pixel of something already known to be too big to
 * matter) while still *visiting* every pixel so the outer loop never
 * revisits a fragment of it: `tooBig` stops appending to `component` (and
 * to `kept`, since a component that's ever exceeded maxArea can't end up
 * <= maxArea) but the flood fill itself keeps running to completion.
 */
export function keepSmallComponents(mask: Uint8Array, width: number, height: number, maxArea: number): Uint8Array {
  const visited = new Uint8Array(mask.length);
  const kept = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let stackLen = 0;
    stack[stackLen++] = start;
    visited[start] = 1;

    const component: number[] = [];
    let size = 0;
    let tooBig = false;

    while (stackLen > 0) {
      const idx = stack[--stackLen]!;
      size++;
      if (!tooBig) {
        component.push(idx);
        if (size > maxArea) tooBig = true; // stop collecting, but keep walking below
      }

      const x = idx % width;
      const y = (idx - x) / width;

      // 4-neighbors, bounds-checked
      if (x > 0) {
        const n = idx - 1;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          stack[stackLen++] = n;
        }
      }
      if (x < width - 1) {
        const n = idx + 1;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          stack[stackLen++] = n;
        }
      }
      if (y > 0) {
        const n = idx - width;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          stack[stackLen++] = n;
        }
      }
      if (y < height - 1) {
        const n = idx + width;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          stack[stackLen++] = n;
        }
      }
    }

    if (!tooBig && size <= maxArea) {
      for (const idx of component) kept[idx] = 1;
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Sharpening — unsharp mask: out = original + amount * (original - blurred)
// ---------------------------------------------------------------------------

export function unsharpMask(image: ImageData, amount: number, radius: number): ImageData {
  const { width, height, data } = image;
  const pixelCount = width * height;

  const r = new Float64Array(pixelCount);
  const g = new Float64Array(pixelCount);
  const b = new Float64Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const di = i * 4;
    r[i] = data[di]!;
    g[i] = data[di + 1]!;
    b[i] = data[di + 2]!;
  }

  const blurR = boxBlurChannel(r, width, height, radius);
  const blurG = boxBlurChannel(g, width, height, radius);
  const blurB = boxBlurChannel(b, width, height, radius);

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < pixelCount; i++) {
    const di = i * 4;
    out[di] = clamp(Math.round(r[i]! + amount * (r[i]! - blurR[i]!)), 0, 255);
    out[di + 1] = clamp(Math.round(g[i]! + amount * (g[i]! - blurG[i]!)), 0, 255);
    out[di + 2] = clamp(Math.round(b[i]! + amount * (b[i]! - blurB[i]!)), 0, 255);
    out[di + 3] = data[di + 3]!;
  }

  return new ImageData(out, width, height);
}

// ---------------------------------------------------------------------------
// Shared numeric helpers
// ---------------------------------------------------------------------------

export function cloneImageData(image: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

/**
 * Box blur via summed-area table: O(w*h) to build the integral image, O(1)
 * per pixel to query the window sum after that, regardless of radius.
 */
export function boxBlurChannel(values: Float64Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return Float32Array.from(values);

  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOut = (y + 1) * stride;
    const rowPrevOut = y * stride;
    for (let x = 0; x < width; x++) {
      rowSum += values[y * width + x]!;
      integral[rowOut + x + 1] = integral[rowPrevOut + x + 1]! + rowSum;
    }
  }

  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = clamp(y - radius, 0, height - 1);
    const y1 = clamp(y + radius, 0, height - 1);
    for (let x = 0; x < width; x++) {
      const x0 = clamp(x - radius, 0, width - 1);
      const x1 = clamp(x + radius, 0, width - 1);

      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)]! -
        integral[y0 * stride + (x1 + 1)]! -
        integral[(y1 + 1) * stride + x0]! +
        integral[y0 * stride + x0]!;

      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      result[y * width + x] = sum / area;
    }
  }

  return result;
}
