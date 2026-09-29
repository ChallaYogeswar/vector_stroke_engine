import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelOutputError, ValidationError } from '../errors';

const { askClaudeAboutImageMock } = vi.hoisted(() => ({ askClaudeAboutImageMock: vi.fn() }));
vi.mock('../anthropic-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../anthropic-client')>();
  return { ...actual, askClaudeAboutImage: askClaudeAboutImageMock };
});

const { handleDescribe, handlePathFeeder } = await import('../handlers');

afterEach(() => {
  askClaudeAboutImageMock.mockReset();
});

describe('handleDescribe', () => {
  it('rejects a missing imageBase64', async () => {
    await expect(handleDescribe(undefined)).rejects.toThrow(ValidationError);
    await expect(handleDescribe({ imageBase64: '' })).rejects.toThrow(ValidationError);
    expect(askClaudeAboutImageMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized imageBase64 without calling the API', async () => {
    const huge = 'a'.repeat(3_000_001);
    await expect(handleDescribe({ imageBase64: huge })).rejects.toThrow(ValidationError);
    expect(askClaudeAboutImageMock).not.toHaveBeenCalled();
  });

  it('trims the model response and returns it as { description }', async () => {
    askClaudeAboutImageMock.mockResolvedValue('  a lighthouse at sunset  ');
    const result = await handleDescribe({ imageBase64: 'abc' });
    expect(result).toEqual({ description: 'a lighthouse at sunset' });
  });

  it('sends jpeg as the media type regardless of what the original upload was', async () => {
    askClaudeAboutImageMock.mockResolvedValue('x');
    await handleDescribe({ imageBase64: 'abc' });
    expect(askClaudeAboutImageMock).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'image/jpeg' }));
  });
});

describe('handlePathFeeder', () => {
  it('rejects a missing imageBase64 without calling the API', async () => {
    await expect(handlePathFeeder(undefined)).rejects.toThrow(ValidationError);
    expect(askClaudeAboutImageMock).not.toHaveBeenCalled();
  });

  it('parses a well-formed JSON response', async () => {
    askClaudeAboutImageMock.mockResolvedValue(
      JSON.stringify({
        focusRegion: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
        suggestedDetail: 'high',
        reasoning: 'busy textured subject',
      }),
    );
    const result = await handlePathFeeder({ imageBase64: 'abc' });
    expect(result).toEqual({
      focusRegion: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      suggestedDetail: 'high',
      reasoning: 'busy textured subject',
    });
  });

  it('strips a ```json code fence the model wraps the JSON in despite being asked not to', async () => {
    askClaudeAboutImageMock.mockResolvedValue(
      '```json\n' + JSON.stringify({ focusRegion: null, suggestedDetail: 'low', reasoning: 'simple' }) + '\n```',
    );
    const result = await handlePathFeeder({ imageBase64: 'abc' });
    expect(result.suggestedDetail).toBe('low');
  });

  it('throws ModelOutputError for a non-JSON response', async () => {
    askClaudeAboutImageMock.mockResolvedValue('sure, here is my analysis: it is a dog');
    await expect(handlePathFeeder({ imageBase64: 'abc' })).rejects.toThrow(ModelOutputError);
  });

  it('throws ModelOutputError when the JSON parses but is not an object (e.g. a bare array)', async () => {
    askClaudeAboutImageMock.mockResolvedValue('[1, 2, 3]');
    await expect(handlePathFeeder({ imageBase64: 'abc' })).rejects.toThrow(ModelOutputError);
  });

  it('degrades suggestedDetail to "medium" rather than failing when the model returns an unrecognized value', async () => {
    askClaudeAboutImageMock.mockResolvedValue(JSON.stringify({ suggestedDetail: 'extreme', reasoning: 'x' }));
    const result = await handlePathFeeder({ imageBase64: 'abc' });
    expect(result.suggestedDetail).toBe('medium');
  });

  it('degrades focusRegion to null rather than failing when coordinates are out of the 0..1 range', async () => {
    askClaudeAboutImageMock.mockResolvedValue(
      JSON.stringify({ focusRegion: { x: 0.5, y: 0.5, width: 1.5, height: 0.5 }, suggestedDetail: 'medium', reasoning: 'x' }),
    );
    const result = await handlePathFeeder({ imageBase64: 'abc' });
    expect(result.focusRegion).toBeNull();
  });

  it('degrades focusRegion to null when a field is missing rather than throwing', async () => {
    askClaudeAboutImageMock.mockResolvedValue(
      JSON.stringify({ focusRegion: { x: 0.1, y: 0.1, width: 0.5 }, suggestedDetail: 'medium', reasoning: 'x' }),
    );
    const result = await handlePathFeeder({ imageBase64: 'abc' });
    expect(result.focusRegion).toBeNull();
  });

  it('defaults reasoning to an empty string rather than throwing when absent', async () => {
    askClaudeAboutImageMock.mockResolvedValue(JSON.stringify({ suggestedDetail: 'medium' }));
    const result = await handlePathFeeder({ imageBase64: 'abc' });
    expect(result.reasoning).toBe('');
  });
});
