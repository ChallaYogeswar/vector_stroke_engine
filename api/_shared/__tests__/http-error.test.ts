import { describe, expect, it } from 'vitest';
import { AnthropicApiError } from '../anthropic-client';
import { ModelOutputError, ValidationError } from '../errors';
import { toHttpErrorPayload } from '../http-error';

describe('toHttpErrorPayload', () => {
  it('maps ValidationError to 400 and passes its message through (it describes what the caller did wrong)', () => {
    const { status, body } = toHttpErrorPayload(new ValidationError('imageBase64 is required.'));
    expect(status).toBe(400);
    expect(body.error).toBe('imageBase64 is required.');
  });

  it('maps ModelOutputError to 502 with a generic message, not the raw parsing detail', () => {
    const { status, body } = toHttpErrorPayload(new ModelOutputError('Model response was not valid JSON.'));
    expect(status).toBe(502);
    expect(body.error).not.toContain('valid JSON');
  });

  it('maps a sub-500 AnthropicApiError status (e.g. 429) through, still with a generic message', () => {
    const { status, body } = toHttpErrorPayload(new AnthropicApiError('rate limited', 429));
    expect(status).toBe(429);
    expect(body.error).not.toContain('rate limited');
  });

  it('maps an AnthropicApiError with a 5xx or missing status to 502', () => {
    expect(toHttpErrorPayload(new AnthropicApiError('boom', 500)).status).toBe(502);
    expect(toHttpErrorPayload(new AnthropicApiError('boom')).status).toBe(502);
  });

  it('maps anything unrecognized (a plain Error, a thrown string) to a generic 500', () => {
    expect(toHttpErrorPayload(new Error('unexpected')).status).toBe(500);
    expect(toHttpErrorPayload('a thrown string, not even an Error').status).toBe(500);
  });
});
