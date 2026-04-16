import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/rag/auth/index.js';
import { setShareEntry } from '../../lib/rag/storage/index.js';
import type { ChunkType, Source } from '../../lib/rag/types.js';
import {
  compileAllowedOriginPatterns,
  isAllowedHttpUrlWithCompiledPatterns,
  parseAllowedOriginPatterns,
  type CompiledOriginPattern,
} from '../../lib/rag/security/url-safety.js';

const ALLOWED_SOURCE_TYPES = new Set<ChunkType>(['readme', 'issue', 'pr', 'release', 'commit']);

function toOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeSource(input: unknown, compiledAllowedPatterns: CompiledOriginPattern[]): Source | null {
  if (!isRecord(input)) return null;

  const type = typeof input.type === 'string' && ALLOWED_SOURCE_TYPES.has(input.type as ChunkType)
    ? (input.type as ChunkType)
    : null;
  const title = typeof input.title === 'string' ? input.title : '';
  const rawUrl = typeof input.url === 'string' ? input.url : '';

  if (!type || !title) return null;

  const sanitized: Source = {
    type,
    title,
    url: isAllowedHttpUrlWithCompiledPatterns(rawUrl, compiledAllowedPatterns) ? rawUrl : '',
  };

  const issueNumber = toOptionalInt(input.issueNumber);
  const prNumber = toOptionalInt(input.prNumber);
  const releaseName = typeof input.releaseName === 'string' ? input.releaseName : undefined;
  const snippet = typeof input.snippet === 'string' ? input.snippet : undefined;

  if (issueNumber !== undefined) sanitized.issueNumber = issueNumber;
  if (prNumber !== undefined) sanitized.prNumber = prNumber;
  if (releaseName !== undefined) sanitized.releaseName = releaseName;
  if (snippet !== undefined) sanitized.snippet = snippet;

  return sanitized;
}

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
  const compiledAllowedPatterns = compileAllowedOriginPatterns(allowedPatterns);
  const sanitizedSources: Source[] = Array.isArray(sources)
    ? sources
      .map((source) => sanitizeSource(source, compiledAllowedPatterns))
      .filter((source): source is Source => source !== null)
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
