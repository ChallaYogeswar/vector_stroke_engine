import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { handleDescribe, handlePathFeeder } from '../api/_shared/handlers';
import { ValidationError } from '../api/_shared/errors';
import { toHttpErrorPayload } from '../api/_shared/http-error';
import type { DescribeRequest, PathFeederRequest } from '../src/engine/ai-types';

/**
 * Dev-only stand-in for Vercel's /api routing. `vite dev` doesn't run
 * serverless functions — Vercel's own `vercel dev` does, but that needs the
 * Vercel CLI and a linked project, a heavier ask than "clone and npm run
 * dev" (see docs/backend-spec.md section 8). This mounts the exact same
 * handleDescribe/handlePathFeeder business logic (api/_shared/handlers.ts)
 * behind plain Node http primitives instead of VercelRequest/VercelResponse
 * — only the transport differs, and only here, so local dev can never
 * silently drift from what's actually deployed by running a second,
 * hand-maintained implementation of the same logic.
 *
 * Stripped from the production bundle: this only runs inside Vite's dev
 * server (configureServer), never touches `vite build`'s output.
 */
export function aiDevProxyPlugin(): Plugin {
  return {
    name: 'vector-stroke-engine:ai-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/describe', (req, res) => {
        void handleRoute(req, res, (body) => handleDescribe(body as DescribeRequest));
      });
      server.middlewares.use('/api/path-feeder', (req, res) => {
        void handleRoute(req, res, (body) => handlePathFeeder(body as PathFeederRequest));
      });
    },
  };
}

async function handleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  run: (body: unknown) => Promise<unknown>,
): Promise<void> {
  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed — POST only.' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await run(body);
    writeJson(res, 200, result);
  } catch (err) {
    console.error('[ai-dev-proxy]', err);
    const { status, body } = toHttpErrorPayload(err);
    writeJson(res, status, body);
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('Request body was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
