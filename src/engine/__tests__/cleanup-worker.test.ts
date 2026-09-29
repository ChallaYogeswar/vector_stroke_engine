import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handleCleanupRequest } from '../preprocess/cleanup-worker';
import type { CleanupWorkerRequest, CleanupWorkerResponse } from '../preprocess/cleanup-worker';
import { createCleanupWorkerClient } from '../preprocess/cleanup-client';
import { DEFAULT_CLEANUP_OPTIONS, cleanupImage } from '../preprocess/cleanup';
import { createDummyImageData, installDomPolyfills } from './test-utils';

beforeAll(() => {
  installDomPolyfills();
});

describe('handleCleanupRequest (worker-side pure logic)', () => {
  it('cleans the transferred image data and echoes requestId/width/height', () => {
    const image = createDummyImageData(12, 10);
    const request: CleanupWorkerRequest = {
      requestId: 42,
      data: new Uint8ClampedArray(image.data),
      width: image.width,
      height: image.height,
      options: DEFAULT_CLEANUP_OPTIONS,
    };

    const response = handleCleanupRequest(request);

    expect(response.requestId).toBe(42);
    expect(response.width).toBe(12);
    expect(response.height).toBe(10);
    // Same output the synchronous pipeline produces for the same input —
    // the worker relays to cleanupImage(), it doesn't reimplement it.
    const expected = cleanupImage(image, DEFAULT_CLEANUP_OPTIONS);
    expect(Array.from(response.data)).toEqual(Array.from(expected.data));
  });
});

// A minimal fake Worker that runs the *real* request/response logic
// (handleCleanupRequest) synchronously and in-process, via a microtask
// instead of an actual background thread. This exercises cleanup-client.ts's
// requestId bookkeeping and transferable-buffer handling against the real
// worker-side contract, without needing jsdom to implement Worker (it
// doesn't).
class FakeWorker {
  onmessage: ((event: MessageEvent<CleanupWorkerResponse>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: CleanupWorkerRequest): void {
    const response = handleCleanupRequest(message);
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<CleanupWorkerResponse>));
  }
  terminate(): void {}
}

class FailingWorker {
  onmessage: ((event: MessageEvent<CleanupWorkerResponse>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(): void {
    queueMicrotask(() => this.onerror?.(new Event('error')));
  }
  terminate(): void {}
}

describe('createCleanupWorkerClient', () => {
  afterEach(() => {
    // Whichever fake got installed on globalThis.Worker must never leak
    // into a later test (or another test file).
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  it('falls back to the synchronous pipeline when Worker is unavailable (true in this test environment)', async () => {
    expect(typeof Worker).toBe('undefined'); // documents the assumption this test relies on

    const client = createCleanupWorkerClient();
    const image = createDummyImageData(8, 8);
    const result = await client.run(image, DEFAULT_CLEANUP_OPTIONS);

    const expected = cleanupImage(image, DEFAULT_CLEANUP_OPTIONS);
    expect(Array.from(result.data)).toEqual(Array.from(expected.data));
    client.terminate();
  });

  it('round-trips a request through a (fake) worker and resolves with the cleaned image', async () => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;

    const client = createCleanupWorkerClient();
    const image = createDummyImageData(8, 8);
    const result = await client.run(image, DEFAULT_CLEANUP_OPTIONS);

    const expected = cleanupImage(image, DEFAULT_CLEANUP_OPTIONS);
    expect(Array.from(result.data)).toEqual(Array.from(expected.data));
    client.terminate();
  });

  it('keeps multiple in-flight requests straight by requestId', async () => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;

    const client = createCleanupWorkerClient();
    const imageA = createDummyImageData(6, 6);
    const imageB = createDummyImageData(9, 5);

    const [resultA, resultB] = await Promise.all([
      client.run(imageA, DEFAULT_CLEANUP_OPTIONS),
      client.run(imageB, DEFAULT_CLEANUP_OPTIONS),
    ]);

    expect(resultA.width).toBe(6);
    expect(resultA.height).toBe(6);
    expect(resultB.width).toBe(9);
    expect(resultB.height).toBe(5);
    client.terminate();
  });

  it("copies the buffer before transfer, so the caller's own ImageData stays usable after run()", async () => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;

    const client = createCleanupWorkerClient();
    const image = createDummyImageData(6, 6);
    const lengthBefore = image.data.length;

    await client.run(image, DEFAULT_CLEANUP_OPTIONS);

    // If the caller's own buffer had been transferred (not copied), it would
    // now be detached: reading it would throw, or its length would be 0.
    expect(image.data.length).toBe(lengthBefore);
    expect(() => image.data[0]).not.toThrow();
    client.terminate();
  });

  it('falls back to the main-thread pipeline for in-flight requests if the worker errors', async () => {
    (globalThis as { Worker?: unknown }).Worker = FailingWorker;

    const client = createCleanupWorkerClient();
    const image = createDummyImageData(8, 8);
    const result = await client.run(image, DEFAULT_CLEANUP_OPTIONS);

    const expected = cleanupImage(image, DEFAULT_CLEANUP_OPTIONS);
    expect(Array.from(result.data)).toEqual(Array.from(expected.data));
    client.terminate();
  });
});
