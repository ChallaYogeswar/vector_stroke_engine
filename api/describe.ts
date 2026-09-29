import type { VercelRequest, VercelResponse } from './_shared/vercel-types';
import type { DescribeRequest } from '../src/engine/ai-types';
import { handleDescribe } from './_shared/handlers';
import { toHttpErrorPayload } from './_shared/http-error';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed — POST only.' });
    return;
  }

  try {
    const result = await handleDescribe(req.body as DescribeRequest | undefined);
    res.status(200).json(result);
  } catch (err) {
    console.error('[api/describe]', err);
    const { status, body } = toHttpErrorPayload(err);
    res.status(status).json(body);
  }
}
