import type { VercelRequest, VercelResponse } from '@vercel/node';
import { classifyQuery } from '../../lib/rag/retrieval/router.js';
import { hybridSearch } from '../../lib/rag/retrieval/hybrid.js';
import { generateAnswer, generateAnswerStream, buildSources } from '../../lib/rag/llm/index.js';
import { verifyGitHubToken, checkRateLimit } from '../../lib/rag/auth/index.js';
import { countRepoChunks } from '../../lib/rag/storage/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Auth ---
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || undefined;
  const auth = await verifyGitHubToken(token);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error });
  }

  const { repo, question } = req.body ?? {};

  if (!repo || typeof repo !== 'string') {
    return res.status(400).json({ error: 'Missing repo in request body' });
  }

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing question in request body' });
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return res.status(400).json({ error: 'Invalid repo format. Use owner/name.' });
  }

  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long (max 500 characters)' });
  }

  try {
    // Fast-fail for repos that have not been indexed yet.
    const chunkCount = await countRepoChunks(repo);
    if (chunkCount === 0) {
      return res.status(200).json({
        answer: 'This repository has not been indexed yet. Please index it first before asking questions.',
        sources: [],
      });
    }

    // --- Rate limit ---
    const rateLimit = await checkRateLimit(auth.login!);
    if (Number.isFinite(rateLimit.limit)) {
      res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
    }
    if (Number.isFinite(rateLimit.remaining)) {
      res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
    }
    if (!rateLimit.allowed) {
      return res.status(429).json({ error: rateLimit.error });
    }

    // 1. Classify the query to determine type filter
    const { typeFilter } = classifyQuery(question);

    // 2. Hybrid retrieval
    const chunks = await hybridSearch(question, repo, 8, typeFilter);

    if (chunks.length === 0) {
      return res.status(200).json({
        answer: 'This repository has not been indexed yet. Please index it first before asking questions.',
        sources: [],
      });
    }

    const wantStream = req.body?.stream === true;

    if (wantStream) {
      // --- SSE streaming ---
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

      const sources = buildSources(chunks);

      for await (const delta of generateAnswerStream(question, repo, chunks)) {
        res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    } else {
      // --- Non-streaming (backwards compatible) ---
      const result = await generateAnswer(question, repo, chunks);
      return res.status(200).json(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
