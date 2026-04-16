import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/rag/auth/index.js';
import { setShareEntry } from '../../lib/rag/storage/index.js';
import type { Source } from '../../lib/rag/types.js';
import { isAllowedHttpUrl, parseAllowedOriginPatterns } from '../../lib/rag/security/url-safety.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(503).json({ error: 'Share links are unavailable because Redis is not configured.' });
  }

  const auth = await authenticateRequest(req, res);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error });
  }

  const { repo, question, answer, sources } = req.body ?? {};
  if (!repo || !question || !answer) {
    return res.status(400).json({ error: 'Missing repo, question, or answer' });
  }

  const allowedPatterns = parseAllowedOriginPatterns(process.env.RAG_ALLOWED_URL_ORIGIN_PATTERNS);
  const sanitizedSources: Source[] = Array.isArray(sources)
    ? (sources as Source[]).map((source) => ({
        ...source,
        url: isAllowedHttpUrl(source.url, allowedPatterns) ? source.url : '',
      }))
    : [];

  const shareId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const entry = {
    id: shareId,
    repo,
    question,
    answer,
    sources: sanitizedSources,
    createdAt: Date.now(),
  };

  await setShareEntry(entry);

  return res.status(200).json({ id: shareId, url: `/share/${shareId}` });
}
