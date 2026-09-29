import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asciiToText,
  canShareFiles,
  canvasToPngBlob,
  downloadText,
  histogramToCSV,
  sanitizeFileNameStem,
  shareOrDownload,
  sketchToSVG,
} from '../export';
import type { AsciiPayload, HistogramPayload, StrokeData } from '../types';
import { installDomPolyfills } from './test-utils';

beforeAll(() => {
  installDomPolyfills();
});

// ---------------------------------------------------------------------------
// Pure serializers — no DOM/canvas involved, just typed data in, string out.
// ---------------------------------------------------------------------------

describe('sketchToSVG', () => {
  const sample: StrokeData = {
    meta: { width: 100, height: 60, totalPoints: 5, layers: 2 },
    layers: [
      { name: 'edges', stroke: '#46e0a0', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }] },
      { name: 'lone-point', stroke: '#7dffc7', points: [{ x: 5, y: 5 }] }, // single point: not a drawable path
    ],
  };

  it('emits a viewBox/width/height matching StrokeData.meta', () => {
    const svg = sketchToSVG(sample);
    expect(svg).toContain('viewBox="0 0 100 60"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="60"');
  });

  it('turns a multi-point layer into a M/L path in that layer\'s stroke color', () => {
    const svg = sketchToSVG(sample);
    expect(svg).toContain('stroke="#46e0a0"');
    expect(svg).toContain('M0.00,0.00 L10.00,5.00 L20.00,0.00');
  });

  it('drops layers with fewer than 2 points — nothing to draw a line between', () => {
    const svg = sketchToSVG(sample);
    expect(svg).not.toContain('#7dffc7');
  });

  it('escapes & and " in stroke values so a hand-edited theme color can\'t break the SVG', () => {
    const withQuote: StrokeData = {
      meta: { width: 10, height: 10, totalPoints: 2, layers: 1 },
      layers: [{ name: 'x', stroke: 'red" onload="evil()', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    };
    const svg = sketchToSVG(withQuote);
    expect(svg).not.toContain('onload="evil()"');
    expect(svg).toContain('&quot;');
  });
});

describe('asciiToText', () => {
  it('reshapes the flat character array into cols-wide, newline-joined rows', () => {
    const payload: AsciiPayload = {
      kind: 'ascii',
      cols: 3,
      rows: 2,
      chars: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    expect(asciiToText(payload)).toBe('abc\ndef');
  });
});

describe('histogramToCSV', () => {
  it('emits a header plus exactly 256 value rows, columns matching the bins', () => {
    const zeros = new Array(256).fill(0);
    const payload: HistogramPayload = {
      kind: 'histogram',
      bins: { red: [...zeros], green: [...zeros], blue: [...zeros], luminance: [...zeros], maxCount: 12 },
    };
    payload.bins.red[0] = 12;
    payload.bins.luminance[255] = 7;

    const csv = histogramToCSV(payload);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('value,red,green,blue,luminance');
    expect(lines.length).toBe(257); // header + 256 buckets
    expect(lines[1]).toBe('0,12,0,0,0');
    expect(lines[256]).toBe('255,0,0,0,7');
  });
});

describe('sanitizeFileNameStem', () => {
  it('strips the extension', () => {
    expect(sanitizeFileNameStem('holiday-photo.jpeg')).toBe('holiday-photo');
  });

  it('replaces OS-unsafe characters rather than passing them through', () => {
    expect(sanitizeFileNameStem('trip: day/one*.png')).toBe('trip- day-one-');
  });

  it('falls back to a default name when sanitizing leaves nothing usable', () => {
    expect(sanitizeFileNameStem('///')).toBe('vector-stroke-engine');
  });
});

// ---------------------------------------------------------------------------
// Browser-API-backed paths — canvas.toBlob, URL.createObjectURL, the Web
// Share API. jsdom implements none of these for real (see test-utils.ts's
// installMockCanvasToBlob/installMockObjectUrl for what's stubbed and why);
// navigator.share/canShare are absent entirely, which conveniently makes
// "share unsupported, falls back to download" the environment's natural
// path, and lets the "share succeeds" / "share dismissed" paths be tested
// by attaching a temporary mock only for that one test.
// ---------------------------------------------------------------------------

describe('canvasToPngBlob', () => {
  it('resolves with a Blob once toBlob\'s callback fires', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const blob = await canvasToPngBlob(canvas);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});

describe('downloadText', () => {
  it('creates an object URL and clicks a throwaway download link', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL');

    downloadText('hello,world', 'test.csv', 'text/csv');

    expect(createUrlSpy).toHaveBeenCalledTimes(1);
    const [blobArg] = createUrlSpy.mock.calls[0] as [Blob];
    expect(blobArg.type).toBe('text/csv');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    createUrlSpy.mockRestore();
  });
});

describe('canShareFiles', () => {
  it('is false in an environment with no Web Share API (this suite\'s default)', () => {
    expect(canShareFiles()).toBe(false);
  });
});

describe('shareOrDownload', () => {
  const nav = navigator as Navigator & {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
  };

  beforeEach(() => {
    Reflect.deleteProperty(nav, 'share');
    Reflect.deleteProperty(nav, 'canShare');
  });

  it('falls back to a download when the Web Share API is unavailable', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const result = await shareOrDownload(new Blob(['x']), 'x.png', 'image/png', 'title');
    expect(result).toBe('downloaded');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('reports "shared" and never touches the download path when navigator.share resolves', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    nav.canShare = () => true;
    nav.share = vi.fn().mockResolvedValue(undefined);

    const result = await shareOrDownload(new Blob(['x']), 'x.png', 'image/png', 'title');

    expect(result).toBe('shared');
    expect(nav.share).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('reports "dismissed" (not an error, not a download) when the user cancels the share sheet', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    nav.canShare = () => true;
    const abortError = new DOMException('cancelled', 'AbortError');
    nav.share = vi.fn().mockRejectedValue(abortError);

    const result = await shareOrDownload(new Blob(['x']), 'x.png', 'image/png', 'title');

    expect(result).toBe('dismissed');
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('falls back to download when share exists but fails for a reason other than AbortError', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    nav.canShare = () => true;
    nav.share = vi.fn().mockRejectedValue(new Error('permission denied'));

    const result = await shareOrDownload(new Blob(['x']), 'x.png', 'image/png', 'title');

    expect(result).toBe('downloaded');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
