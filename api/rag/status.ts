import type { VercelRequest, VercelResponse } from '@vercel/node';
import { countRepoChunks, normalizeRepo } from '../../lib/rag/storage/index.js';

function parseIfNoneMatch(headerValue: string | undefined): Set<string> {
  if (!headerValue) return new Set();
  return new Set(
    headerValue
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawRepo = req.query.repo;
  if (!rawRepo || typeof rawRepo !== 'string') {
    return res.status(400).json({ error: 'Missing repo query parameter (e.g. ?repo=owner/name)' });
  }

  // Validate repo format
  if (!/^[\w.-]+\/[\w.-]+$/.test(rawRepo)) {
    return res.status(400).json({ error: 'Invalid repo format. Use owner/name.' });
  }

  const repo = normalizeRepo(rawRepo);

  try {
    const chunkCount = await countRepoChunks(repo);
    const etag = `"status-${repo.toLowerCase()}-${chunkCount}"`;
    const ifNoneMatchValues = parseIfNoneMatch(req.headers['if-none-match']);

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');

    if (ifNoneMatchValues.has('*') || ifNoneMatchValues.has(etag) || ifNoneMatchValues.has(`W/${etag}`)) {
      return res.status(304).end();
    }

    return res.status(200).json({
      indexed: chunkCount > 0,
      chunkCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
