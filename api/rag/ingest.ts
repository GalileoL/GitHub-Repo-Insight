import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchRepoData, fetchRepoSourceFiles } from '../../lib/rag/github/fetchers.js';
import { chunkRepoData } from '../../lib/rag/chunking/index.js';
import { embedTexts } from '../../lib/rag/embeddings/index.js';
import { prewarmEmbeddings } from '../../lib/rag/llm/index.js';
import {
  upsertChunks,
  deleteRepoChunks,
  setRepoChunkCount,
  normalizeRepo,
} from '../../lib/rag/storage/index.js';
import { authenticateRequest, checkIngestRateLimit } from '../../lib/rag/auth/index.js';
import {
  incrementAlertStreak,
  resetAlertStreak,
  checkAndFireStreakAlert,
} from '../../lib/admin/alert-manager.js';

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

  const { repo: rawRepo } = req.body ?? {};
  // Use the authenticated user's token for GitHub data fetching
  const githubToken = auth.token;

  if (!rawRepo || typeof rawRepo !== 'string') {
    return res.status(400).json({ error: 'Missing repo in request body' });
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(rawRepo)) {
    return res.status(400).json({ error: 'Invalid repo format. Use owner/name.' });
  }

  const repo = normalizeRepo(rawRepo);

  try {
    // 1. Fetch raw data from GitHub (community data + source files in parallel)
    const rawData = await fetchRepoData(repo, githubToken);
    let sourceResult: Awaited<ReturnType<typeof fetchRepoSourceFiles>> | null = null;
    let codeSummaryFailed = false;
    let codeSummaryFailureReason: string | undefined;
    try {
      sourceResult = await fetchRepoSourceFiles(repo, githubToken, rawData);
    } catch (sourceErr) {
      codeSummaryFailed = true;
      codeSummaryFailureReason = sourceErr instanceof Error ? sourceErr.message : 'unknown';
      console.warn(JSON.stringify({
        type: 'ingest_code_summary_fetch_failed',
        repo,
        reason: codeSummaryFailureReason,
      }));
    }

    if (codeSummaryFailed) {
      try {
        await incrementAlertStreak('ingest_failure_streak', repo);
        await checkAndFireStreakAlert('ingest_failure_streak', repo, 3, { repo });
      } catch { /* best-effort */ }

      return res.status(503).json({
        status: 'error',
        chunksIndexed: 0,
        codeSummaryCount: 0,
        codeSummaryFailed: true,
        codeSummaryFailureReason,
        error: 'Failed to fetch source files for code summary indexing',
        message: 'Failed to fetch source files for code summary indexing',
      });
    }

    // Merge source files into raw data for unified chunking
    if (sourceResult) {
      rawData.sourceFiles = sourceResult.files;
      rawData.headSha = sourceResult.headSha;
    }

    // 2. Chunk the data
    const chunks = chunkRepoData(repo, rawData);

    if (chunks.length === 0) {
      await setRepoChunkCount(repo, 0);
      return res.status(200).json({
        status: 'ok',
        chunksIndexed: 0,
        codeSummaryCount: 0,
        codeSummaryFailed,
        codeSummaryFailureReason,
        message: 'No data to index',
      });
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

    try {
      await resetAlertStreak('ingest_failure_streak', repo);
    } catch { /* best-effort */ }

    return res.status(200).json({
      status: 'ok',
      chunksIndexed: chunks.length,
      codeSummaryCount: chunks.filter((chunk) => chunk.metadata.type === 'code_summary').length,
      codeSummaryFailed,
      codeSummaryFailureReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    try {
      await incrementAlertStreak('ingest_failure_streak', repo);
      await checkAndFireStreakAlert('ingest_failure_streak', repo, 3, { repo });
    } catch { /* best-effort */ }
    return res.status(500).json({ status: 'error', error: message, chunksIndexed: 0, message });
  }
}
