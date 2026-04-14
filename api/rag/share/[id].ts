import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getShareEntry } from '../../../lib/rag/storage/index.js';

function parseIfNoneMatch(headerValue: string | undefined): Set<string> {
  if (!headerValue) return new Set();
  return new Set(
    headerValue
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function parseIfModifiedSince(headerValue: string | undefined): number | undefined {
  if (!headerValue) return undefined;
  const value = Date.parse(headerValue);
  return Number.isNaN(value) ? undefined : value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing share id' });
  }

  const entry = await getShareEntry(id);
  if (!entry) {
    return res.status(404).json({ error: 'Share not found or expired' });
  }

  const etag = `"share-${entry.id}-${entry.createdAt}"`;
  const ifNoneMatchValues = parseIfNoneMatch(req.headers['if-none-match']);
  const ifModifiedSince = parseIfModifiedSince(req.headers['if-modified-since']);
  const cacheControl = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', new Date(entry.createdAt).toUTCString());
  res.setHeader('Cache-Control', cacheControl);

  if (ifNoneMatchValues.has('*') || ifNoneMatchValues.has(etag) || ifNoneMatchValues.has(`W/${etag}`)) {
    return res.status(304).end();
  }

  if (typeof ifModifiedSince === 'number' && entry.createdAt <= ifModifiedSince) {
    return res.status(304).end();
  }

  return res.status(200).json(entry);
}
