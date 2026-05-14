import type { VercelRequest, VercelResponse } from '@vercel/node';
import { classifyQuery } from '../../lib/rag/retrieval/router.js';
import { hybridSearch } from '../../lib/rag/retrieval/hybrid.js';
import {
  generateAnswerStream,
  generateAnswerStreamFromContext,
  buildSources,
  buildContextText,
} from '../../lib/rag/llm/index.js';
import { authenticateRequest, checkRateLimit } from '../../lib/rag/auth/index.js';
import {
  countRepoChunks,
  getStreamSession,
  normalizeRepo,
  setStreamSessionSnapshot,
  setStreamSessionProgress,
  deleteStreamSession,
  writeEvalEventBatch,
} from '../../lib/rag/storage/index.js';
import {
  ServerMetricsRecorder,
  categorizeError,
  logStreamMetrics,
} from '../../lib/rag/metrics/index.js';
import {
  codeFetchStage,
  updateCodeFetchAlerts,
} from '../../lib/rag/code-fetch.js';
import type { CodeFetchResult } from '../../lib/rag/code-fetch.js';

function buildResumeEvalEvents(args: {
  repo: string;
  login: string;
  category: string;
  chunkCount: number;
  codeFetchResult: CodeFetchResult | null;
  answerLength: number;
  sourceCount: number;
  hasCodeContext: boolean;
  streamCancelled: boolean;
}) {
  return {
    retrieval: {
      repo: args.repo,
      login: args.login,
      category: args.category,
      queryCategory: args.category,
      firstPassCount: args.chunkCount,
      finalCount: args.chunkCount,
    },
    code_fetch: args.codeFetchResult
      ? {
          repo: args.repo,
          login: args.login,
          fetchedFiles: args.codeFetchResult.fetchedFiles,
          failedFiles: args.codeFetchResult.failedFiles,
          summaryOnlyFallback: args.codeFetchResult.usedSummaryOnlyFallback,
          usedSummaryOnlyFallback: args.codeFetchResult.usedSummaryOnlyFallback,
        }
      : undefined,
    answer: {
      repo: args.repo,
      login: args.login,
      answerLength: args.answerLength,
      sourceCount: args.sourceCount,
      usedRetrievedCode: args.hasCodeContext,
      hasCodeContext: args.hasCodeContext,
      streamCancelled: args.streamCancelled,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Auth ---
  const auth = await authenticateRequest(req, res);
  if (!auth.authenticated) {
    return res.status(401).json({ error: auth.error });
  }

  const { requestId, lastSeq } = req.body ?? {};

  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'Missing requestId in request body' });
  }
  if (typeof lastSeq !== 'number' || lastSeq < 0) {
    return res.status(400).json({ error: 'Missing or invalid lastSeq in request body' });
  }

  const session = await getStreamSession(requestId);
  if (!session) {
    return res.status(404).json({ error: 'Stream session not found or expired' });
  }
  if (session.login !== auth.login) {
    return res.status(403).json({ error: 'Cannot resume stream for a different user' });
  }

  const repo = normalizeRepo(session.repo);
  const question = session.question;
  const hasSnapshot = typeof session.contextText === 'string' && Array.isArray(session.sources);
  const storedContextText = session.contextText ?? '';
  const storedContextPrefix = session.contextPrefix;
  const storedSources = session.sources ?? [];
  const token = auth.token ?? null;

  try {
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

    let chunks = [] as Awaited<ReturnType<typeof hybridSearch>>;
    let sources = storedSources;
    let contextText = storedContextText;
    let contextPrefix = storedContextPrefix;
    let category: 'documentation' | 'community' | 'changes' | 'code' | 'general' = 'general';
    let codeFetchResult: CodeFetchResult | null = null;

    if (!hasSnapshot) {
      // Fast-fail for repos that have not been indexed yet.
      const chunkCount = await countRepoChunks(repo);
      if (chunkCount === 0) {
        return res.status(200).json({
          answer: 'This repository has not been indexed yet. Please index it first before asking questions.',
          sources: [],
        });
      }

      // 1. Classify the query to determine type filter
      const classified = classifyQuery(question);
      const { typeFilter } = classified;
      category = classified.category;

      // 2. Hybrid retrieval
      chunks = await hybridSearch(question, repo, 8, typeFilter, category);

      if (chunks.length === 0) {
        return res.status(200).json({
          answer: 'This repository has not been indexed yet. Please index it first before asking questions.',
          sources: [],
        });
      }

      if (category === 'code' && token) {
        try {
          codeFetchResult = await codeFetchStage(chunks, repo, token);
          if (codeFetchResult.codeContext) {
            contextPrefix = codeFetchResult.codeContext;
          }
          await updateCodeFetchAlerts(repo, codeFetchResult);
        } catch {
          // best-effort: resume still falls back to summaries
        }
      }

      sources = buildSources(chunks);
      contextText = buildContextText(chunks);
    }

    // --- Initialize metrics ---
    const metrics = new ServerMetricsRecorder();
    metrics.setChunkCount(hasSnapshot ? storedSources.length : chunks.length);

    // --- SSE streaming with heartbeat, request ID, and metrics ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.setHeader('X-Request-ID', requestId);

    const checkpointSeq = Math.max(0, session.lastSeq ?? 0);
    if (lastSeq > checkpointSeq) {
      return res.status(409).json({ error: 'Resume checkpoint is stale. Please retry the question.' });
    }
    const checkpointAnswer = session.partialAnswer ?? '';

    await setStreamSessionSnapshot({
      requestId,
      login: auth.login!,
      repo,
      question,
      createdAt: Date.now(),
      contextText,
      contextPrefix,
      sources,
    });
    await setStreamSessionProgress(requestId, {
      lastSeq: checkpointSeq,
      partialAnswer: checkpointAnswer,
    });

    // Send initial meta event for client correlation
    res.write(`data: ${JSON.stringify({ type: 'meta', requestId, repo, question, resume: true, lastSeq: checkpointSeq })}\n\n`);
    metrics.incrementEventCount();

    let aborted = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let streamCompleted = false;
    let answerSoFar = checkpointAnswer;
    const cleanup = () => {
      aborted = true;
    };
    req.on('close', cleanup);
    req.on('error', cleanup);

    let seq = checkpointSeq;

    try {
      const generator = hasSnapshot
        ? generateAnswerStreamFromContext(
            question,
            repo,
            contextText,
            contextPrefix,
            checkpointAnswer,
          )
        : generateAnswerStream(question, repo, chunks, contextPrefix, checkpointAnswer);

      const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
          if (!aborted && res.writable) {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', requestId })}\n\n`);
            metrics.incrementEventCount();
          }
        }, 20000);
      };
      startHeartbeat();

      for await (const delta of generator) {
        if (aborted) {
          metrics.recordError('Stream aborted by client');
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream aborted by client' })}\n\n`);
          metrics.incrementEventCount();
          await setStreamSessionProgress(requestId, { lastSeq: seq, partialAnswer: answerSoFar });
          break;
        }

        seq += 1;
        answerSoFar += delta;

        // Update session position every 10 deltas to allow resume
        if (seq % 10 === 0) {
          await setStreamSessionProgress(requestId, { lastSeq: seq, partialAnswer: answerSoFar });
        }

        res.write(`data: ${JSON.stringify({ type: 'delta', seq, content: delta })}\n\n`);
        metrics.incrementEventCount();
      }

      if (!aborted) {
        await setStreamSessionProgress(requestId, { lastSeq: seq, partialAnswer: answerSoFar });

        res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
        metrics.incrementEventCount();
        res.write(`data: [DONE]\n\n`);
        metrics.incrementEventCount();

        streamCompleted = true;
      }
    } catch (streamErr) {
      const errorMessage = streamErr instanceof Error ? streamErr.message : 'Stream error';
      const errorToRecord = streamErr instanceof Error ? streamErr : new Error(errorMessage);
      metrics.recordError(errorToRecord, categorizeError(errorToRecord));
      metrics.incrementErrorCount();

      // Persist last known seq in case of stream failure
      await setStreamSessionProgress(requestId, { lastSeq: seq, partialAnswer: answerSoFar });

      if (!res.headersSent) {
        res.status(500).json({ error: errorMessage });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`);
        metrics.incrementEventCount();
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      req.removeListener('close', cleanup);
      req.removeListener('error', cleanup);

      if (streamCompleted) {
        await deleteStreamSession(requestId);
      }

      const finalMetrics = metrics.end();
      logStreamMetrics(`[resume.ts stream] ${repo}`, finalMetrics);
      void writeEvalEventBatch(requestId, hasSnapshot
        ? {
            answer: {
              repo,
              login: auth.login!,
              answerLength: answerSoFar.length,
              sourceCount: sources.length,
              usedRetrievedCode: Boolean(contextPrefix),
              hasCodeContext: Boolean(contextPrefix),
              streamCancelled: aborted,
            },
          }
        : buildResumeEvalEvents({
            repo,
            login: auth.login!,
            category,
            chunkCount: chunks.length,
            codeFetchResult,
            answerLength: answerSoFar.length,
            sourceCount: sources.length,
            hasCodeContext: Boolean(contextPrefix),
            streamCancelled: aborted,
          }));
      res.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
