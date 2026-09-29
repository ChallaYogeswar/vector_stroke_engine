import { AnthropicApiError } from './anthropic-client';
import { ModelOutputError, ValidationError } from './errors';
import type { ApiErrorResponse } from '../../src/engine/ai-types';

export interface HttpErrorPayload {
  status: number;
  body: ApiErrorResponse;
}

/**
 * Maps the error categories api/_shared/handlers.ts can throw to an HTTP
 * status + a client-safe message, independent of which HTTP transport
 * writes the response (Vercel's VercelResponse in production, a raw Node
 * ServerResponse in the dev proxy — see dev-server/ai-proxy-plugin.ts and
 * docs/backend-spec.md section 8). Callers are responsible for logging the raw
 * error server-side (console.error) — this only decides what's safe to
 * send back to the client; see docs/backend-spec.md section 7 for why upstream
 * error detail specifically never reaches the client as-is.
 */
export function toHttpErrorPayload(err: unknown): HttpErrorPayload {
  if (err instanceof ValidationError) {
    return { status: 400, body: { error: err.message } };
  }
  if (err instanceof ModelOutputError) {
    return { status: 502, body: { error: 'The AI model returned something this endpoint could not use. Try again.' } };
  }
  if (err instanceof AnthropicApiError) {
    const status = err.status !== undefined && err.status < 500 ? err.status : 502;
    return { status, body: { error: 'The AI service is unavailable right now. Try again shortly.' } };
  }
  return { status: 500, body: { error: 'Unexpected server error.' } };
}
