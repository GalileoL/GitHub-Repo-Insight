import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/rag/auth/index.js';
import { writeEvalFeedback } from '../../lib/rag/storage/index.js';

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

  if (Object.keys(feedback).length === 0) {
    return res.status(400).json({ error: 'Missing feedback payload' });
  }

  await writeEvalFeedback(requestId, feedback);
  return res.status(200).json({ ok: true });
}
