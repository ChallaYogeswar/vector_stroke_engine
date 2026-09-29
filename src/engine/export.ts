import type { AsciiPayload, HistogramPayload, StrokeData } from './types';

// ---------------------------------------------------------------------------
// Export / share — build-spec Phase 6's client-side-feasible half.
//
// Phase 6 in build-spec section 8 bundles three things together:
// AI-path-feeder, AI-describe, and export/share. Section 2 is explicit that
// the first two "need a backend + key handling" and are deferred — that
// hasn't changed, there's still no backend in this project (section 4:
// "Backend: None for v1"). Export/share doesn't have that dependency at
// all: every capability here is a browser API call against data already in
// memory, so it ships now rather than waiting on a backend decision that
// belongs to the AI half specifically. See README.md's Phase 6 section for
// the full breakdown.
//
// Two primitives everything else is built from:
//   - downloadBlob / downloadText: hand the browser a file to save, via a
//     throwaway object URL and a hidden <a download> click. This is the
//     entire client-side "export" story — no server, no upload.
//   - shareOrDownload: layers the Web Share API's file-sharing path on top
//     (the OS share sheet — AirDrop, Messages, etc.) where supported,
//     falling back to the same download for everywhere it isn't. This is
//     deliberately NOT "generate a shareable link" — that's the "sharing
//     backend" build-spec section 2 defers, a genuinely different feature
//     (a link needs somewhere server-side to point to; a share-sheet hand-
//     off doesn't).
// ---------------------------------------------------------------------------

/** Renders a canvas to a PNG Blob. Works for every mode, including Mode3D — its WebGL frame is already blitted onto this same 2D canvas every render (see mode-3d.ts), so there's nothing mode-specific to branch on here. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export this canvas — it may be empty.'));
    }, 'image/png');
  });
}

/** Triggers a browser "Save As" for binary content via a throwaway object URL + hidden <a download>. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay, not immediately — Safari has been known to cancel
  // an in-flight download if the object URL disappears synchronously after
  // the click that triggered it.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Triggers a browser "Save As" for text content (SVG/CSV/TXT), tagged with the given MIME type. */
export function downloadText(text: string, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

/** True when this browser can share files via the Web Share API — used to decide whether a UI shows "Share" at all, vs. just "Download". */
export function canShareFiles(): boolean {
  const nav = navigator as ShareCapableNavigator;
  if (!nav.share || !nav.canShare) return false;
  try {
    // A throwaway 1-byte probe — canShare() only checks type/shape support, it doesn't actually share this file.
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Hands `blob` to the OS share sheet when the browser supports file
 * sharing, falling back to a plain download otherwise. The user dismissing
 * the share sheet (AbortError) resolves as 'dismissed', not a thrown error
 * — that's a normal outcome, not a failure.
 */
export async function shareOrDownload(
  blob: Blob,
  fileName: string,
  mimeType: string,
  shareTitle: string,
): Promise<'shared' | 'downloaded' | 'dismissed'> {
  const nav = navigator as ShareCapableNavigator;

  if (nav.share && nav.canShare) {
    const file = new File([blob], fileName, { type: mimeType });
    const shareData: ShareData = { files: [file], title: shareTitle };
    if (nav.canShare(shareData)) {
      try {
        await nav.share(shareData);
        return 'shared';
      } catch (err) {
        // DOMException — the real-world shape of an AbortError from a
        // rejected share() call — isn't reliably `instanceof Error` (it
        // isn't in jsdom; the DOM spec treats it as a distinct interface,
        // and engines vary on whether they chain it to Error), so this
        // checks `.name` directly rather than gating on instanceof first.
        if (isAbortError(err)) return 'dismissed';
        // Any other share failure (permissions quirk, etc.) — fall through to a plain download below.
      }
    }
  }

  downloadBlob(blob, fileName);
  return 'downloaded';
}

// ---------------------------------------------------------------------------
// Mode-specific data exports. PNG (above) covers every mode as a raster
// snapshot; these three cover the modes where the underlying *data*, not
// just a picture of it, is worth exporting on its own.
// ---------------------------------------------------------------------------

/** Serializes Sketch's StrokeData into a standalone SVG document of real vector paths — not a raster snapshot, matching what this mode (and the app's name) is actually about. */
export function sketchToSVG(data: StrokeData): string {
  const { meta, layers } = data;
  const paths = layers
    .filter((layer) => layer.points.length >= 2)
    .map((layer) => {
      const d = layer.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round2(p.x)},${round2(p.y)}`).join(' ');
      return `  <path d="${d}" fill="none" stroke="${escapeAttr(layer.stroke)}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${meta.width} ${meta.height}" width="${meta.width}" height="${meta.height}">`,
    `  <rect width="${meta.width}" height="${meta.height}" fill="#0b0c0e" />`,
    paths,
    `</svg>`,
  ].join('\n');
}

/** Flattens ASCII's character grid into plain newline-separated rows — the raw art itself, not a picture of it. */
export function asciiToText(payload: AsciiPayload): string {
  const { cols, rows, chars } = payload;
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    lines.push(chars.slice(y * cols, y * cols + cols).join(''));
  }
  return lines.join('\n');
}

/** Serializes Histogram's per-channel bucket counts into a CSV: one row per 0-255 value, one column per channel — the numbers behind the chart. */
export function histogramToCSV(payload: HistogramPayload): string {
  const { red, green, blue, luminance } = payload.bins;
  const rows = ['value,red,green,blue,luminance'];
  for (let v = 0; v < 256; v++) {
    rows.push(`${v},${red[v]},${green[v]},${blue[v]},${luminance[v]}`);
  }
  return rows.join('\n');
}

/** Strips characters that are unsafe in a filename on at least one major OS, so an oddly-named source photo can't produce a broken download name. */
export function sanitizeFileNameStem(name: string): string {
  const withoutExt = name.replace(/\.[^./\\]+$/, '');
  const cleaned = withoutExt.replace(/[\\/:*?"<>|]+/g, '-').trim();
  // A name that was nothing but separators (e.g. "///") sanitizes down to
  // just dashes — non-empty by length, but not an actual usable stem, so
  // this checks for at least one character beyond whitespace/dashes rather
  // than just cleaned.length > 0.
  const hasContent = /[^\s-]/.test(cleaned);
  return hasContent ? cleaned : 'vector-stroke-engine';
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
}

function round2(value: number): string {
  return value.toFixed(2);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
