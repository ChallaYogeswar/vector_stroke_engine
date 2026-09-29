import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicApiError, askClaudeAboutImage } from '../anthropic-client';

const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];

describe('askClaudeAboutImage', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-123';
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
    vi.unstubAllGlobals();
  });

  it('throws AnthropicApiError before ever calling fetch when the API key is unset', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      askClaudeAboutImage({ imageBase64: 'abc', mediaType: 'image/jpeg', prompt: 'p', maxTokens: 10 }),
    ).rejects.toThrow(AnthropicApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the image+text content blocks in the documented Messages API shape', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'a description' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await askClaudeAboutImage({ imageBase64: 'abc123', mediaType: 'image/jpeg', prompt: 'describe it', maxTokens: 42 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key-123');

    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(42);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' },
    });
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: 'describe it' });
  });

  it('returns the text block content on a successful call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: 'text', text: '  a photo of a cat  ' }] }), { status: 200 }),
      ),
    );

    const result = await askClaudeAboutImage({ imageBase64: 'x', mediaType: 'image/jpeg', prompt: 'p', maxTokens: 10 });
    // Trimming is handleDescribe's job (handlers.ts), not this layer's — verifying the raw pass-through here.
    expect(result).toBe('  a photo of a cat  ');
  });

  it('throws AnthropicApiError carrying the upstream status on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));

    await expect(
      askClaudeAboutImage({ imageBase64: 'x', mediaType: 'image/jpeg', prompt: 'p', maxTokens: 10 }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('throws AnthropicApiError when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    await expect(
      askClaudeAboutImage({ imageBase64: 'x', mediaType: 'image/jpeg', prompt: 'p', maxTokens: 10 }),
    ).rejects.toThrow(AnthropicApiError);
  });

  it('throws AnthropicApiError when the response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json{{', { status: 200 })));

    await expect(
      askClaudeAboutImage({ imageBase64: 'x', mediaType: 'image/jpeg', prompt: 'p', maxTokens: 10 }),
    ).rejects.toThrow(AnthropicApiError);
  });

  it('throws AnthropicApiError when the response has no text content block (e.g. tool-use only)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'tool_use' }] }), { status: 200 })),
    );

    await expect(
      askClaudeAboutImage({ imageBase64: 'x', mediaType: 'image/jpeg', prompt: 'p', maxTokens: 10 }),
    ).rejects.toThrow(AnthropicApiError);
  });
});
