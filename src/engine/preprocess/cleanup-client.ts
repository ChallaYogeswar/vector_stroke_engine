// ---------------------------------------------------------------------------
// Main-thread client for the cleanup Web Worker (see cleanup-worker.ts).
//
// One worker per client instance, created lazily on the first call and kept
// alive across calls (useEngine.ts creates one client for the component's
// lifetime and calls terminate() on unmount) — cheaper than spinning up a
// fresh worker per call once cleanup options become a live-toggled UI
// surface (docs/controls-spec.md), since that's now a repeated action, not a
// once-per-upload one.
//
// Falls back to the synchronous, same-thread cleanupImage() whenever Worker
// isn't available at all (very old browsers) or the worker itself fails at
// runtime (e.g. blocked by a restrictive CSP) — the cleanup pipeline running
// matters more than which thread it runs on.
// ---------------------------------------------------------------------------

import { cleanupImage, type CleanupOptions } from './cleanup';
import type { CleanupWorkerRequest, CleanupWorkerResponse } from './cleanup-worker';

export interface CleanupWorkerClient {
  run(image: ImageData, options: CleanupOptions): Promise<ImageData>;
  terminate(): void;
}

interface PendingRequest {
  image: ImageData;
  options: CleanupOptions;
  resolve: (result: ImageData) => void;
}

export function createCleanupWorkerClient(): CleanupWorkerClient {
  if (typeof Worker === 'undefined') {
    return {
      run: (image, options) => Promise.resolve(cleanupImage(image, options)),
      terminate: () => {},
    };
  }

  let worker: Worker | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();

  function handleMessage(event: MessageEvent<CleanupWorkerResponse>): void {
    const { requestId, data, width, height } = event.data;
    const entry = pending.get(requestId);
    if (!entry) return; // already handled (e.g. via handleError) or a stale message
    pending.delete(requestId);
    entry.resolve(new ImageData(data, width, height));
  }

  function handleError(): void {
    // The worker thread itself broke (not a per-request failure —
    // cleanupImage never throws on a well-formed ImageData). Resolve every
    // still-pending call on the main thread instead of leaving callers
    // waiting forever, then drop the worker so the next run() starts clean.
    for (const entry of pending.values()) entry.resolve(cleanupImage(entry.image, entry.options));
    pending.clear();
    worker?.terminate();
    worker = null;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    const w = new Worker(new URL('./cleanup-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = handleMessage;
    w.onerror = handleError;
    worker = w;
    return w;
  }

  function run(image: ImageData, options: CleanupOptions): Promise<ImageData> {
    const w = ensureWorker();
    const requestId = nextRequestId++;

    return new Promise((resolve) => {
      pending.set(requestId, { image, options, resolve });

      // Copy the buffer (not the caller's own image.data.buffer) before
      // transferring it: transferring detaches the buffer on this side, and
      // the caller (useEngine.ts) keeps its own ImageData around afterward
      // to re-run cleanup later without needing to re-decode the upload.
      const buffer = image.data.buffer.slice(0);
      const request: CleanupWorkerRequest = {
        requestId,
        data: new Uint8ClampedArray(buffer),
        width: image.width,
        height: image.height,
        options,
      };
      w.postMessage(request, [buffer]);
    });
  }

  function terminate(): void {
    worker?.terminate();
    worker = null;
    pending.clear();
  }

  return { run, terminate };
}
