const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Model choice for both AI endpoints — isolated to this one constant since
 * it's the most likely thing to change (cost/quality tradeoff, a newer
 * model). Both /api/describe and /api/path-feeder ask for a short, cheap
 * response (a couple sentences; a small JSON object), not deep reasoning,
 * so the smallest current vision-capable tier is the deliberate default
 * rather than an oversized one. See docs/backend-spec.md section 3 — provider
 * and model are both meant to be a one-file change, not threaded through
 * the rest of the code.
 */
const MODEL = 'claude-haiku-4-5-20251001';

/** The API call itself failed — bad key, rate limit, provider outage, malformed response envelope. Distinct from ModelOutputError (api/_shared/errors.ts), which is for a *successful* call whose content didn't parse as expected. */
export class AnthropicApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AnthropicApiError';
    this.status = status;
  }
}

export interface AnthropicImageMessage {
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png';
  prompt: string;
  maxTokens: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
}

/**
 * Thin wrapper over the Messages API's image+text input shape. Deliberately
 * not the @anthropic-ai/sdk package — see docs/backend-spec.md section 3: this
 * project already avoids dependencies it doesn't need, and two endpoints
 * each making one API call don't need a full SDK on top of Node's built-in
 * fetch (stable since Node 18 — see package.json's `engines` field).
 */
export async function askClaudeAboutImage(message: AnthropicImageMessage): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new AnthropicApiError(
      'ANTHROPIC_API_KEY is not set on the server. See docs/backend-spec.md section 8 for local/deployed setup.',
    );
  }

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: message.maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: message.mediaType, data: message.imageBase64 } },
              { type: 'text', text: message.prompt },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    throw new AnthropicApiError(`Could not reach the Anthropic API: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    // Upstream error bodies can carry more detail than we want to hand a
    // client (see docs/backend-spec.md section 7) — captured here for the
    // caller to log server-side, but http-error.ts never forwards this
    // message as-is to an HTTP response.
    const bodyText = await response.text().catch(() => '');
    throw new AnthropicApiError(`Anthropic API returned ${response.status}: ${bodyText.slice(0, 300)}`, response.status);
  }

  let data: AnthropicMessagesResponse;
  try {
    data = (await response.json()) as AnthropicMessagesResponse;
  } catch {
    throw new AnthropicApiError('Anthropic API returned a response that was not valid JSON.');
  }

  const textBlock = data.content.find((block) => block.type === 'text' && typeof block.text === 'string');
  if (!textBlock || typeof textBlock.text !== 'string') {
    throw new AnthropicApiError('Anthropic API response had no text content block.');
  }
  return textBlock.text;
}
