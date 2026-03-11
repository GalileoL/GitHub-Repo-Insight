import type { VercelRequest, VercelResponse } from '@vercel/node';
import { countRepoChunks } from '../../lib/rag/storage/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const repo = req.query.repo;
  if (!repo || typeof repo !== 'string') {
    return res.status(400).json({ error: 'Missing repo query parameter (e.g. ?repo=owner/name)' });
  }

  // Validate repo format
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return res.status(400).json({ error: 'Invalid repo format. Use owner/name.' });
  }

  try {
    const chunkCount = await countRepoChunks(repo);
    return res.status(200).json({
      indexed: chunkCount > 0,
      chunkCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
