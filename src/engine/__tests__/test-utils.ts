import type { RenderContext } from '../types';

/**
 * jsdom implements HTMLCanvasElement but not a real 2D rendering context
 * (that needs the native `canvas` package, which this project deliberately
 * doesn't depend on). We stub the handful of CanvasRenderingContext2D
 * methods/properties the mode engines actually call, at the prototype
 * level, so `document.createElement('canvas').getContext('2d')` — called
 * both by test code and internally by Mode2D — resolves to the same fake
 * context everywhere.
 */
/**
 * jsdom covers the DOM but not the Canvas API surface, so `ImageData` (used
 * throughout src/engine — it's the currency every mode and the cleanup
 * pipeline operate on) doesn't exist as a global in the test environment.
 * This is a minimal stand-in covering both constructor overloads actually
 * used in this codebase.
 */
class PolyfillImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / (4 * widthOrHeight);
    }
  }
}

export function installDomPolyfills(): void {
  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as unknown as { ImageData: unknown }).ImageData = PolyfillImageData;
  }
  installMockCanvasContext();
  installMockCanvasToBlob();
  installMockObjectUrl();
}

export function installMockCanvasContext(): void {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (this: HTMLCanvasElement, contextId: string) => unknown;
  };

  proto.getContext = function mockGetContext(this: HTMLCanvasElement, contextId: string) {
    if (contextId !== '2d') return null;
    return createMock2DContext();
  };
}

function createMock2DContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    canvas: undefined,
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    drawImage: () => {},
    putImageData: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(Math.max(1, w), Math.max(1, h)),
    fillText: () => {},
    strokeText: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    stroke: () => {},
    fill: () => {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

export function createMockRenderContext(width: number, height: number): RenderContext {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createMockRenderContext: mock 2D context not installed.');
  return { canvas, ctx, width, height };
}

/**
 * jsdom's HTMLCanvasElement.prototype.toBlob is a documented stub — it logs
 * "Not implemented" and never invokes its callback (confirmed empirically;
 * without the native `canvas` package there's no real pixel buffer to
 * encode). export.ts's canvasToPngBlob() depends on the callback actually
 * firing, so this replaces it with one that does: a placeholder Blob of the
 * requested type, delivered on a microtask to match the real API's async
 * contract rather than resolving synchronously.
 */
function installMockCanvasToBlob(): void {
  const proto = HTMLCanvasElement.prototype as unknown as {
    toBlob: (callback: (blob: Blob | null) => void, type?: string) => void;
  };

  proto.toBlob = function mockToBlob(callback: (blob: Blob | null) => void, type = 'image/png') {
    queueMicrotask(() => callback(new Blob([new Uint8Array([1, 2, 3, 4])], { type })));
  };
}

/**
 * jsdom doesn't implement URL.createObjectURL/revokeObjectURL at all (both
 * `undefined` — confirmed empirically). export.ts's downloadBlob() needs
 * *some* string back to assign as an <a href>; this hands out unique
 * `blob:mock/<n>` tokens without tracking real object identity, which is as
 * much fidelity as a DOM-less test run needs.
 */
function installMockObjectUrl(): void {
  let counter = 0;
  const urlCtor = URL as unknown as {
    createObjectURL?: (obj: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  urlCtor.createObjectURL = () => `blob:mock/${++counter}`;
  urlCtor.revokeObjectURL = () => {};
}

export function createDummyImageData(width = 4, height = 4): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 37) % 255;
    data[i + 1] = (i * 61) % 255;
    data[i + 2] = (i * 89) % 255;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}
