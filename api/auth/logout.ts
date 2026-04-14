import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearGitHubSession } from '../../lib/rag/auth/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  clearGitHubSession(res);
  return res.status(200).json({ ok: true });
}
