// ---------------------------------------------------------------------------
// Shared numeric helpers for everything under src/engine/.
//
// These used to be copy-pasted per file (a `clamp` in two modes, a `clamp01`
// in three files, `cellRange` in both ASCII and 3D, and an identically-bodied
// `clampInt` living in preprocess/cleanup.ts that every mode imported just to
// clamp a number). One home, no behavior change.
// ---------------------------------------------------------------------------

/** Constrains `value` to [min, max]. Does not round — callers that need an integer round first. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Constrains `value` to [0, 1]. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * The [start, end) source-pixel range that grid cell `index` (of `count`)
 * covers along one axis, guaranteed non-empty even when `count` exceeds
 * `sourceSize`. Shared by ASCII's glyph grid and 3D's mesh grid.
 */
export function cellRange(index: number, count: number, sourceSize: number): [number, number] {
  const start = Math.min(sourceSize - 1, Math.floor((index / count) * sourceSize));
  const end = Math.min(sourceSize, Math.max(start + 1, Math.floor(((index + 1) / count) * sourceSize)));
  return [start, end];
}
