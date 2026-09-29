import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ModeId, RenderPayload, StrokeData } from '../engine/types';
import {
  asciiToText,
  canShareFiles,
  canvasToPngBlob,
  downloadText,
  histogramToCSV,
  sanitizeFileNameStem,
  shareOrDownload,
  sketchToSVG,
} from '../engine/export';

// ---------------------------------------------------------------------------
// Export — build-spec Phase 6, client-side half (see export.ts's header
// comment for why this ships without the AI-path-feeder/AI-describe half
// of Phase 6, which build-spec section 2 still defers pending a backend).
//
// Two actions:
//   - "Share" / "Download PNG" — always available once an image is loaded,
//     works identically across all five modes since they all render to the
//     one shared 2D canvas.
//   - a second, mode-specific button (SVG for Sketch, TXT for ASCII, CSV
//     for Histogram) that exports the underlying *data*, not a picture of
//     it. 2D and 3D don't get one — there's no data-vs-picture distinction
//     for a posterized raster or a mesh snapshot the way there is for
//     vector strokes, character text, or a bucket table.
// ---------------------------------------------------------------------------

interface ExportControlProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  activeMode: ModeId;
  output: StrokeData | RenderPayload | null;
  fileName: string | null;
}

type ExportStatus = 'idle' | 'busy' | 'done' | 'error';

export function ExportControl({ canvasRef, activeMode, output, fileName }: ExportControlProps) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const messageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shareAvailable] = useState(canShareFiles);

  useEffect(
    () => () => {
      if (messageTimeout.current) clearTimeout(messageTimeout.current);
    },
    [],
  );

  const showMessage = (nextStatus: ExportStatus, text: string) => {
    setStatus(nextStatus);
    setMessage(text);
    if (messageTimeout.current) clearTimeout(messageTimeout.current);
    messageTimeout.current = setTimeout(() => setStatus('idle'), 4000);
  };

  const clearMessage = () => {
    if (messageTimeout.current) clearTimeout(messageTimeout.current);
    setStatus('idle');
    setMessage(null);
  };

  const disabled = output === null || status === 'busy';
  const stem = sanitizeFileNameStem(fileName ?? 'vector-stroke-engine');

  const handlePngExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus('busy');
    try {
      const blob = await canvasToPngBlob(canvas);
      const result = await shareOrDownload(blob, `${stem}-${activeMode}.png`, 'image/png', 'Vector Stroke Engine render');
      if (result === 'shared') showMessage('done', 'Shared.');
      else if (result === 'dismissed') clearMessage();
      else showMessage('done', 'PNG downloaded.');
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Could not export PNG.');
    }
  };

  const handleDataExport = () => {
    if (!output) return;
    try {
      if (activeMode === 'sketch' && 'meta' in output) {
        downloadText(sketchToSVG(output), `${stem}-sketch.svg`, 'image/svg+xml');
        showMessage('done', 'SVG downloaded.');
      } else if (activeMode === 'ascii' && 'kind' in output && output.kind === 'ascii') {
        downloadText(asciiToText(output), `${stem}-ascii.txt`, 'text/plain');
        showMessage('done', 'TXT downloaded.');
      } else if (activeMode === 'histogram' && 'kind' in output && output.kind === 'histogram') {
        downloadText(histogramToCSV(output), `${stem}-histogram.csv`, 'text/csv');
        showMessage('done', 'CSV downloaded.');
      }
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Could not export data.');
    }
  };

  const dataLabel = dataExportLabel(activeMode);

  return (
    <div>
      <p className="rail-section-label">Export</p>
      <div className="export-actions">
        <button type="button" className="export-button" onClick={handlePngExport} disabled={disabled}>
          {shareAvailable ? 'Share / Save PNG' : 'Download PNG'}
        </button>
        {dataLabel && (
          <button type="button" className="export-button export-button--secondary" onClick={handleDataExport} disabled={disabled}>
            {dataLabel}
          </button>
        )}
      </div>
      {message && (
        <p className={`export-message${status === 'error' ? ' export-message--error' : ''}`}>{message}</p>
      )}
    </div>
  );
}

function dataExportLabel(mode: ModeId): string | null {
  switch (mode) {
    case 'sketch':
      return 'Download SVG';
    case 'ascii':
      return 'Download TXT';
    case 'histogram':
      return 'Download CSV';
    default:
      return null;
  }
}
