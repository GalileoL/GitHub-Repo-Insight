import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyGitHubToken } from '../../lib/rag/auth/index.js';
import { setShareEntry } from '../../lib/rag/storage/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || undefined;
  const auth = await verifyGitHubToken(token);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error });
  }

  const { repo, question, answer, sources } = req.body ?? {};
  if (!repo || !question || !answer) {
    return res.status(400).json({ error: 'Missing repo, question, or answer' });
  }

  const shareId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const entry = {
    id: shareId,
    repo,
    question,
    answer,
    sources: Array.isArray(sources) ? sources : [],
    createdAt: Date.now(),
  };

  await setShareEntry(entry);

  return res.status(200).json({ id: shareId, url: `/share/${shareId}` });
}
