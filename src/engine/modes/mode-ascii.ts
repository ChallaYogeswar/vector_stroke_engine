import type { ModeEngine, RenderContext, AsciiPayload } from '../types';
import { cellRange, clamp } from '../math';
import { readThemeColors, withAlpha } from '../theme';

// ---------------------------------------------------------------------------
// ASCII — "character-art render, reusing the same luminance sampling as
// histogram/sketch" (build-spec 3.2 #4).
//
// process() (once per upload/mode-switch):
//   1. Pick a character-grid resolution from the source image's aspect
//      ratio. `cols` tracks image width directly (clamped to a sane range);
//      `rows` is corrected by CHAR_ASPECT, since a monospace glyph cell is
//      roughly twice as tall as it is wide — without that correction a
//      square grid of characters renders the image visibly stretched
//      vertically.
//   2. Average-sample the luminance (same Rec.709 weights ModeSketch,
//      ModeHistogram, and cleanup.ts use) under each grid cell.
//   3. Map each cell's average luminance to a glyph via a fixed
//      ink-density ramp — darkest source pixels get the sparsest glyph
//      (a space, i.e. no ink at all), brightest get the densest. That's the
//      inverse of the classic "dark ink on white paper" ASCII-art mapping,
//      because this mode's theme is a dark terminal: brighter photo
//      content should read as *more* glowing character, not less, matching
//      how the Sketch mode's strokes work (light lines on near-black).
//
// render() reveals characters row-major as `progress` advances — the same
// "progress is a budget over an ordered sequence" pattern ModeSketch uses
// for its strokes and ModeHistogram uses for its bar rise-in — with a
// terminal-style cursor block at the most recently "typed" cell.
// ---------------------------------------------------------------------------

const RAMP = ' .:-=+*#%@'; // ascending ink density; index 0 (space) is never drawn
const MAX_COLS = 140;
const MIN_COLS = 8;
const MAX_ROWS = 90;
const MIN_ROWS = 6;
const CHAR_ASPECT = 0.5; // width:height of a typical monospace glyph cell

export interface ASCIIOptions {
  /** Column count (density) override. `null` (default) tracks the source image's width, clamped to [MIN_COLS, MAX_COLS], exactly as before this option existed. */
  targetCols: number | null;
}

export const DEFAULT_ASCII_OPTIONS: ASCIIOptions = { targetCols: null };
export const ASCII_TARGET_COLS_RANGE = { min: MIN_COLS, max: MAX_COLS } as const;

export class ModeASCII implements ModeEngine {
  readonly id = 'ascii' as const;

  private payload: AsciiPayload | null = null;
  private options: ASCIIOptions = { ...DEFAULT_ASCII_OPTIONS };

  /** See docs/controls-spec.md section 3.1 — additive, not part of the locked ModeEngine interface. */
  configure(options: Partial<ASCIIOptions>): void {
    const nextTargetCols = options.targetCols === undefined ? this.options.targetCols : options.targetCols;
    this.options = {
      targetCols:
        nextTargetCols === null
          ? null
          : clamp(Math.round(nextTargetCols), ASCII_TARGET_COLS_RANGE.min, ASCII_TARGET_COLS_RANGE.max),
    };
  }

  process(image: ImageData): AsciiPayload {
    const { width, height } = image;
    const cols = clamp(this.options.targetCols ?? width, MIN_COLS, MAX_COLS);
    const rows = clamp(Math.round(cols * (height / width) * CHAR_ASPECT), MIN_ROWS, MAX_ROWS);

    const chars = new Array<string>(cols * rows);
    for (let gy = 0; gy < rows; gy++) {
      const [y0, y1] = cellRange(gy, rows, height);
      for (let gx = 0; gx < cols; gx++) {
        const [x0, x1] = cellRange(gx, cols, width);
        const luminance = averageLuminance(image, x0, x1, y0, y1);
        const rampIndex = Math.round((luminance / 255) * (RAMP.length - 1));
        chars[gy * cols + gx] = RAMP[rampIndex]!;
      }
    }

    this.payload = { kind: 'ascii', cols, rows, chars };
    return this.payload;
  }

  render(renderCtx: RenderContext, progress: number): void {
    const { ctx, width, height } = renderCtx;
    ctx.clearRect(0, 0, width, height);
    if (!this.payload) return;

    const { cols, rows, chars } = this.payload;
    const total = cols * rows;

    // Cells are rectangular, not square: `rows` was already halved by
    // CHAR_ASPECT in process() so that a plain-text export (asciiToText —
    // rendered in an actual monospace font, whose glyph cells run ~2x
    // taller than wide) reads at the source image's proportions. Drawing
    // that grid here with a single square `cellSize` ignored that and
    // squashed the on-canvas preview vertically by ~2x versus the .txt
    // export and the source photo. cellHeight is derived from cellWidth via
    // the same CHAR_ASPECT so the two stay in lockstep if that constant
    // ever changes.
    const cellWidth = Math.max(1, Math.min(width / cols, (height / rows) * CHAR_ASPECT));
    const cellHeight = cellWidth / CHAR_ASPECT;
    const gridW = cellWidth * cols;
    const gridH = cellHeight * rows;
    const offsetX = (width - gridW) / 2;
    const offsetY = (height - gridH) / 2;

    let revealed = Math.floor(progress * total);
    if (progress > 0 && revealed === 0) revealed = 1; // don't sit blank on the animation's first frame

    const theme = readThemeColors();
    // Based on cellHeight (the taller dimension): a monospace glyph's
    // advance width is roughly 0.55-0.6em, so sizing off the ~2x-taller
    // cell and scaling down keeps glyphs from overlapping horizontally
    // while still filling the cell vertically.
    const fontSize = Math.max(4, cellHeight * 0.85);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${fontSize}px "JetBrains Mono", monospace`;

    for (let i = 0; i < revealed; i++) {
      const ch = chars[i]!;
      if (ch === ' ') continue;

      const gx = i % cols;
      const gy = (i - gx) / cols;
      const cx = offsetX + (gx + 0.5) * cellWidth;
      const cy = offsetY + (gy + 0.5) * cellHeight;

      const level = RAMP.indexOf(ch) / (RAMP.length - 1);
      ctx.fillStyle = withAlpha(theme.accent, 0.3 + level * 0.7);
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = level > 0.55 ? 4 : 0;
      ctx.fillText(ch, cx, cy);
    }
    ctx.shadowBlur = 0;

    // Terminal cursor block at the most recently "typed" cell.
    if (revealed > 0 && revealed < total) {
      const cursorIdx = revealed - 1;
      const gx = cursorIdx % cols;
      const gy = (cursorIdx - gx) / cols;
      ctx.fillStyle = withAlpha(theme.accentStrong, 0.5);
      ctx.fillRect(offsetX + gx * cellWidth, offsetY + gy * cellHeight, cellWidth, cellHeight);
    }

    ctx.restore();
  }

  reset(): void {
    this.payload = null;
  }
}

// ---------------------------------------------------------------------------
// Grid sampling helpers
// ---------------------------------------------------------------------------

function averageLuminance(image: ImageData, x0: number, x1: number, y0: number, y1: number): number {
  const { width, data } = image;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}
