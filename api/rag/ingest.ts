import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchRepoData, fetchRepoSourceFiles } from '../../lib/rag/github/fetchers.js';
import { chunkRepoData } from '../../lib/rag/chunking/index.js';
import { embedTexts } from '../../lib/rag/embeddings/index.js';
import { prewarmEmbeddings } from '../../lib/rag/llm/index.js';
import { upsertChunks, deleteRepoChunks, setRepoChunkCount } from '../../lib/rag/storage/index.js';
import { authenticateRequest, checkIngestRateLimit } from '../../lib/rag/auth/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Auth (require login) ---
  const auth = await authenticateRequest(req, res);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error });
  }

  if (!auth.token) {
    return res.status(401).json({ error: 'Missing GitHub access token in authenticated session.' });
  }

  // --- Rate limit for indexing ---
  const rateLimit = await checkIngestRateLimit(auth.login!);
  if (Number.isFinite(rateLimit.limit)) {
    res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  }
  if (Number.isFinite(rateLimit.remaining)) {
    res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  }
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: rateLimit.error });
  }

  const { repo } = req.body ?? {};
  // Use the authenticated user's token for GitHub data fetching
  const githubToken = auth.token;

  if (!repo || typeof repo !== 'string') {
    return res.status(400).json({ error: 'Missing repo in request body' });
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return res.status(400).json({ error: 'Invalid repo format. Use owner/name.' });
  }

  try {
    // 1. Fetch raw data from GitHub (community data + source files in parallel)
    const rawData = await fetchRepoData(repo, githubToken);
    const sourceResult = await fetchRepoSourceFiles(repo, githubToken, rawData).catch(() => null);

    // Merge source files into raw data for unified chunking
    if (sourceResult) {
      rawData.sourceFiles = sourceResult.files;
      rawData.headSha = sourceResult.headSha;
    }

    // 2. Chunk the data
    const chunks = chunkRepoData(repo, rawData);

    if (chunks.length === 0) {
      await setRepoChunkCount(repo, 0);
      return res.status(200).json({ status: 'ok', chunksIndexed: 0, message: 'No data to index' });
    }

    // 3. Generate embeddings
    const texts = chunks.map((c) => c.content);
    const embeddings = await embedTexts(texts);

    // 4. Delete old chunks for this repo (re-index)
    await deleteRepoChunks(repo);

    // 5. Upsert new chunks
    await upsertChunks(chunks, embeddings);
    await setRepoChunkCount(repo, chunks.length);

    // Kick off a best-effort embedding pre-warm to reduce first-query latency
    void prewarmEmbeddings();

    return res.status(200).json({
      status: 'ok',
      chunksIndexed: chunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ status: 'error', error: message, chunksIndexed: 0, message });
  }
}
