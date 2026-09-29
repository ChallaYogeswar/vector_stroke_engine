import type { ModeEngine, RenderContext, HistogramPayload, HistogramBins } from '../types';
import { clamp01 } from '../math';
import { readThemeColors, withAlpha } from '../theme';

// ---------------------------------------------------------------------------
// Histogram — "RGB + luminance distribution as a live chart" (build-spec
// 3.2 #3): cheap, reuses the pixel data already decoded for every mode.
// This is also the one mode running the light "print report" theme
// (build-spec section 6) instead of the shared dark shell.
//
// process(): single pass over the cleaned ImageData, one 256-bucket count
// per channel (R, G, B) plus luminance (same Rec.709 weights ModeSketch and
// cleanup.ts use, so all three "brightness" readings in this app agree).
//
// render(): luminance drawn as a filled silhouette behind three thin R/G/B
// line traces — real red/green/blue rather than the theme accent, since
// that's the whole point of a channel chart: a green line reading as the
// app's teal accent would defeat the purpose. Bucket heights use a sqrt
// scale (not linear, not log) so a dominant peak — a large flat sky, a
// solid-color background — doesn't flatten the rest of the distribution to
// invisible, without the more aggressive compression a log scale gives.
// `progress` drives a simple rise-in (bars grow from the baseline) rather
// than being ignored — a static readout doesn't need per-frame redraws,
// but there's no reason to leave the Timeline machinery idle either.
// ---------------------------------------------------------------------------

const BUCKETS = 256;

export class ModeHistogram implements ModeEngine {
  readonly id = 'histogram' as const;

  private payload: HistogramPayload | null = null;

  process(image: ImageData): HistogramPayload {
    this.payload = { kind: 'histogram', bins: computeBins(image) };
    return this.payload;
  }

  render(renderCtx: RenderContext, progress: number): void {
    const { ctx, width, height } = renderCtx;
    ctx.clearRect(0, 0, width, height);
    if (!this.payload) return;

    const theme = readThemeColors();
    const pad = { top: 28, right: 20, bottom: 28, left: 20 };
    const chartX = pad.left;
    const chartY = pad.top;
    const chartW = Math.max(1, width - pad.left - pad.right);
    const chartH = Math.max(1, height - pad.top - pad.bottom);

    drawAxis(ctx, chartX, chartY, chartW, chartH, theme.border);
    drawLegend(ctx, chartX, chartY - 14, theme);

    const rise = easeOutCubic(clamp01(progress));
    const { bins } = this.payload;

    drawChannel(ctx, bins.luminance, bins.maxCount, chartX, chartY, chartW, chartH, rise, {
      style: 'fill',
      color: withAlpha(theme.accent, 0.16),
      lineColor: withAlpha(theme.accent, 0.55),
    });
    drawChannel(ctx, bins.red, bins.maxCount, chartX, chartY, chartW, chartH, rise, {
      style: 'line',
      color: withAlpha('#c1443c', 0.85),
    });
    drawChannel(ctx, bins.green, bins.maxCount, chartX, chartY, chartW, chartH, rise, {
      style: 'line',
      color: withAlpha('#3f8f5c', 0.85),
    });
    drawChannel(ctx, bins.blue, bins.maxCount, chartX, chartY, chartW, chartH, rise, {
      style: 'line',
      color: withAlpha('#3f6fb0', 0.85),
    });
  }

  reset(): void {
    this.payload = null;
  }
}

// ---------------------------------------------------------------------------
// Bin computation
// ---------------------------------------------------------------------------

function computeBins(image: ImageData): HistogramBins {
  const { data } = image;
  const red = new Array<number>(BUCKETS).fill(0);
  const green = new Array<number>(BUCKETS).fill(0);
  const blue = new Array<number>(BUCKETS).fill(0);
  const luminance = new Array<number>(BUCKETS).fill(0);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    red[r]!++;
    green[g]!++;
    blue[b]!++;
    const l = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
    luminance[l]!++;
  }

  let maxCount = 0;
  for (let v = 0; v < BUCKETS; v++) {
    maxCount = Math.max(maxCount, red[v]!, green[v]!, blue[v]!, luminance[v]!);
  }

  return { red, green, blue, luminance, maxCount: Math.max(1, maxCount) };
}

// ---------------------------------------------------------------------------
// Chart drawing
// ---------------------------------------------------------------------------

interface ChannelStyle {
  style: 'fill' | 'line';
  color: string;
  lineColor?: string;
}

function drawChannel(
  ctx: CanvasRenderingContext2D,
  bucket: number[],
  maxCount: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rise: number,
  style: ChannelStyle,
): void {
  const heightFor = (count: number): number => (Math.sqrt(count) / Math.sqrt(maxCount)) * h * rise;
  const stepX = w / (BUCKETS - 1);

  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let v = 0; v < BUCKETS; v++) {
    const px = x + v * stepX;
    const py = y + h - heightFor(bucket[v]!);
    ctx.lineTo(px, py);
  }

  if (style.style === 'fill') {
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = style.color;
    ctx.fill();
    if (style.lineColor) {
      ctx.strokeStyle = style.lineColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function drawAxis(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: string,
): void {
  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + h + 0.5);
  ctx.lineTo(x + w, y + h + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, theme: { textSecondary: string }): void {
  const entries: Array<{ label: string; color: string }> = [
    { label: 'LUMINANCE', color: theme.textSecondary },
    { label: 'RED', color: '#c1443c' },
    { label: 'GREEN', color: '#3f8f5c' },
    { label: 'BLUE', color: '#3f6fb0' },
  ];

  ctx.save();
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';

  let cursorX = x;
  for (const entry of entries) {
    ctx.fillStyle = entry.color;
    ctx.fillRect(cursorX, y - 3, 8, 8);

    ctx.fillStyle = theme.textSecondary;
    ctx.fillText(entry.label, cursorX + 12, y + 1);

    cursorX += 12 + ctx.measureText(entry.label).width + 18;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}
