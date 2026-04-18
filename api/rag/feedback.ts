import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/rag/auth/index.js';
import {
  getEvalFields,
  writeEvalFeedback,
} from '../../lib/rag/storage/index.js';

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateRequest(req, res);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error });
  }

  const { requestId, thumbsUp, thumbsDown, userRetried } = req.body ?? {};
  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'Missing requestId' });
  }

  const feedback: Record<string, unknown> = {};
  if (isBoolean(thumbsUp)) feedback.thumbsUp = thumbsUp;
  if (isBoolean(thumbsDown)) feedback.thumbsDown = thumbsDown;
  if (isBoolean(userRetried)) feedback.userRetried = userRetried;

  if (thumbsUp === true && thumbsDown === true) {
    return res.status(400).json({ error: 'thumbsUp and thumbsDown cannot both be true' });
  }

  if (Object.keys(feedback).length === 0) {
    return res.status(400).json({ error: 'Missing feedback payload' });
  }

  const evalFields = await getEvalFields(requestId, ['retrieval']);
  if (evalFields === null) {
    return res.status(503).json({ error: 'Evaluation storage unavailable' });
  }
  if (!evalFields.retrieval) {
    return res.status(404).json({ error: 'Unknown requestId' });
  }

  try {
    const retrieval = JSON.parse(evalFields.retrieval) as { login?: string };
    if (!retrieval.login || retrieval.login !== auth.login) {
      return res.status(403).json({ error: 'Cannot write feedback for another user' });
    }
  } catch {
    return res.status(400).json({ error: 'Malformed evaluation record' });
  }

  const wrote = await writeEvalFeedback(requestId, feedback);
  if (!wrote) {
    return res.status(503).json({ error: 'Evaluation storage unavailable' });
  }
  return res.status(200).json({ ok: true });
}
