// ---------------------------------------------------------------------------
// Worker entry point — runs cleanupImage() off the main thread.
//
// The synchronous, same-thread cleanup pipeline was fine while it only ran
// once per upload (see useEngine.ts's old MAX_DIMENSION comment). controls-spec
// adds live cleanup-option toggles that re-run this pipeline on demand,
// which makes a main-thread block during every toggle a real, repeated cost
// rather than a one-time one on upload. This file only relays work to the
// already-tested cleanupImage() in cleanup.ts — no cleanup logic lives here.
//
// A note on typing: this project's tsconfig.app.json uses the DOM lib
// project-wide (every other file under src/ needs it). DOM and WebWorker are
// two separate, *incompatible* ambient global sets in TypeScript — merging
// them into one program produces real conflicts (e.g. `postMessage` and
// `self` have different shapes in each lib). Splitting this one file into
// its own tsconfig project is the textbook fix, but it's a build-config
// change with its own footprint for a single file. Instead, `self` is
// re-typed here to exactly the worker surface this file uses, which sidesteps
// the lib conflict entirely without touching the rest of the build.
// ---------------------------------------------------------------------------

import { cleanupImage, DEFAULT_CLEANUP_OPTIONS, type CleanupOptions } from './cleanup';

export interface CleanupWorkerRequest {
  requestId: number;
  data: ImageDataArray;
  width: number;
  height: number;
  options: CleanupOptions;
}

export interface CleanupWorkerResponse {
  requestId: number;
  data: ImageDataArray;
  width: number;
  height: number;
}

/**
 * Pure request -> response transform, with no dependency on `self` or
 * `postMessage`. Exported so tests (and cleanup-client.ts's in-process mock
 * Worker used to test the request/response contract) can exercise the exact
 * logic a real worker thread runs, without needing a real worker thread.
 */
export function handleCleanupRequest(request: CleanupWorkerRequest): CleanupWorkerResponse {
  const image = new ImageData(request.data, request.width, request.height);
  const cleaned = cleanupImage(image, request.options ?? DEFAULT_CLEANUP_OPTIONS);
  return { requestId: request.requestId, data: cleaned.data, width: cleaned.width, height: cleaned.height };
}

interface CleanupWorkerScope {
  postMessage(message: CleanupWorkerResponse, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<CleanupWorkerRequest>) => void) | null;
}

// `typeof self !== 'undefined'` isn't enough to detect "am I actually inside
// a worker" — jsdom's `window` (used by the test environment) is also
// reachable as `self`, and `Window.postMessage` exists too (it's the
// cross-window messaging API), so checking for that alone would install
// `onmessage` in every test that merely imports this module. `importScripts`
// is genuinely worker-only — Window never has it — so it's used here purely
// as a runtime feature probe (accessed via an index signature, not a bare
// identifier, since it isn't an ambient global under this project's DOM-only
// tsconfig lib).
const runtimeSelf = typeof self !== 'undefined' ? (self as unknown as Record<string, unknown>) : undefined;
const isWorkerScope = typeof runtimeSelf?.['importScripts'] === 'function';

if (isWorkerScope && runtimeSelf) {
  const workerSelf = runtimeSelf as unknown as CleanupWorkerScope;
  workerSelf.onmessage = (event) => {
    const response = handleCleanupRequest(event.data);
    workerSelf.postMessage(response, [response.data.buffer]);
  };
}
