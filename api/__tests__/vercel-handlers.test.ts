import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '../_shared/vercel-types';

const { handleDescribeMock, handlePathFeederMock } = vi.hoisted(() => ({
  handleDescribeMock: vi.fn(),
  handlePathFeederMock: vi.fn(),
}));
vi.mock('../_shared/handlers', () => ({
  handleDescribe: handleDescribeMock,
  handlePathFeeder: handlePathFeederMock,
}));

const { default: describeHandler } = await import('../describe');
const { default: pathFeederHandler } = await import('../path-feeder');

/** Minimal VercelRequest/VercelResponse stand-in — just enough surface for these two handlers, same spirit as test-utils.ts's mock canvas context. */
function mockReqRes(method: string, body?: unknown) {
  const req = { method, body } as VercelRequest;
  const jsonCalls: Array<{ status: number; body: unknown }> = [];
  let currentStatus = 200;
  const res = {
    status(code: number) {
      currentStatus = code;
      return res;
    },
    json(body: unknown) {
      jsonCalls.push({ status: currentStatus, body });
      return res;
    },
  } as unknown as VercelResponse;
  return { req, res, jsonCalls };
}

afterEach(() => {
  handleDescribeMock.mockReset();
  handlePathFeederMock.mockReset();
  vi.restoreAllMocks();
});

describe('api/describe handler', () => {
  it('rejects non-POST with 405 without touching handleDescribe', async () => {
    const { req, res, jsonCalls } = mockReqRes('GET');
    await describeHandler(req, res);
    expect(handleDescribeMock).not.toHaveBeenCalled();
    expect(jsonCalls).toEqual([{ status: 405, body: { error: 'Method not allowed — POST only.' } }]);
  });

  it('passes req.body to handleDescribe and returns its result as 200', async () => {
    handleDescribeMock.mockResolvedValue({ description: 'a mountain' });
    const { req, res, jsonCalls } = mockReqRes('POST', { imageBase64: 'abc' });

    await describeHandler(req, res);

    expect(handleDescribeMock).toHaveBeenCalledWith({ imageBase64: 'abc' });
    expect(jsonCalls).toEqual([{ status: 200, body: { description: 'a mountain' } }]);
  });

  it('maps a thrown ValidationError to 400 rather than a raw 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ValidationError } = await import('../_shared/errors');
    handleDescribeMock.mockRejectedValue(new ValidationError('imageBase64 is required.'));
    const { req, res, jsonCalls } = mockReqRes('POST', {});

    await describeHandler(req, res);

    expect(jsonCalls).toEqual([{ status: 400, body: { error: 'imageBase64 is required.' } }]);
  });
});

describe('api/path-feeder handler', () => {
  it('rejects non-POST with 405 without touching handlePathFeeder', async () => {
    const { req, res, jsonCalls } = mockReqRes('PUT');
    await pathFeederHandler(req, res);
    expect(handlePathFeederMock).not.toHaveBeenCalled();
    expect(jsonCalls).toEqual([{ status: 405, body: { error: 'Method not allowed — POST only.' } }]);
  });

  it('passes req.body to handlePathFeeder and returns its result as 200', async () => {
    const payload = { focusRegion: null, suggestedDetail: 'medium' as const, reasoning: 'even lighting' };
    handlePathFeederMock.mockResolvedValue(payload);
    const { req, res, jsonCalls } = mockReqRes('POST', { imageBase64: 'abc' });

    await pathFeederHandler(req, res);

    expect(jsonCalls).toEqual([{ status: 200, body: payload }]);
  });
});
