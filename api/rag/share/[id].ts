import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getShareEntry } from '../../../lib/rag/storage/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing share id' });
  }

  const entry = await getShareEntry(id);
  if (!entry) {
    return res.status(404).json({ error: 'Share not found or expired' });
  }

  return res.status(200).json(entry);
}
