import type { VercelRequest, VercelResponse } from '@vercel/node';
import { classifyQuery } from '../../lib/rag/retrieval/router.js';
import { hybridSearch } from '../../lib/rag/retrieval/hybrid.js';
import {
  generateAnswer,
  generateAnswerStream,
  buildSources,
  buildContextText,
} from '../../lib/rag/llm/index.js';
import { verifyGitHubToken, checkRateLimit } from '../../lib/rag/auth/index.js';
import {
  countRepoChunks,
  setStreamSessionSnapshot,
  setStreamSessionProgress,
  deleteStreamSession,
} from '../../lib/rag/storage/index.js';
import {
  ServerMetricsRecorder,
  categorizeError,
  logStreamMetrics,
} from '../../lib/rag/metrics/index.js';
import { analyzeAndRewrite, computeConfidence } from '../../lib/rag/retrieval/rewrite.js';
import { mergeResults, toScoredChunks, buildDiagnosticSnapshots } from '../../lib/rag/retrieval/merge.js';
import { rerank } from '../../lib/rag/retrieval/rerank.js';
import type { RetrievalDiagnostics, ScoredChunk } from '../../lib/rag/types.js';
import { classifyIntent, executeAnalyticsQuery } from '../../lib/rag/intents/index.js';

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

    // ── Intent classification ──
    const intentResult = classifyIntent(question);
    const needsAnalytics = intentResult.intent !== 'semantic_qa' && intentResult.analyticsQuery !== null;

    // ── Compute exact analytics data when needed ──
    let analyticsContext = '';
    let analyticsAnswer: string | null = null;
    if (needsAnalytics) {
      try {
        const analyticsResult = await executeAnalyticsQuery(repo, intentResult.analyticsQuery!, token);
        const { data } = analyticsResult;
        analyticsAnswer = analyticsResult.answer;
        // Build structured context for the LLM — exact facts, not prose
        const lines = [
          `[Verified data from GitHub API — these numbers are exact, do NOT approximate or hedge]`,
          `Entity: ${data.entity}`,
          `Operation: ${data.op}`,
          `State filter: ${data.state}`,
          `Count: ${data.count}`,
        ];
        if (data.dateRange) {
          lines.push(`Date range: ${data.dateRange.since.slice(0, 10)} to ${data.dateRange.until.slice(0, 10)}`);
        }
        if (data.truncated) {
          lines.push(`Note: pagination limit reached — count may be a lower bound`);
        }
        if (data.topAuthors?.length) {
          lines.push(`Top authors: ${data.topAuthors.map((a) => `${a.author} (${a.count})`).join(', ')}`);
        }
        analyticsContext = lines.join('\n') + '\n\n';
      } catch (analyticsErr) {
        console.log(JSON.stringify({
          type: 'analytics_fallback',
          repo,
          intent: intentResult.intent,
          error: analyticsErr instanceof Error ? analyticsErr.message : 'Unknown error',
        }));
        // On failure: repo_analytics degrades to semantic_qa, hybrid continues with RAG only
      }
    }

    // ── For pure analytics with successful data, skip retrieval and return deterministic output ──
    if (intentResult.intent === 'repo_analytics' && analyticsAnswer) {
      // Pure analytics can return deterministic output directly.
      const sources: ReturnType<typeof buildSources> = [];

      const wantStream = req.body?.stream === true;
      if (wantStream) {
        const metrics = new ServerMetricsRecorder();
        const requestId = metrics.getRequestId();
        metrics.setChunkCount(0);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('X-Request-ID', requestId);

        await setStreamSessionSnapshot({
          requestId,
          login: auth.login!,
          repo,
          question,
          createdAt: Date.now(),
          contextText: '',
          contextPrefix: analyticsContext,
          sources,
        });
        await setStreamSessionProgress(requestId, { lastSeq: 0, partialAnswer: '' });

        let aborted = false;
        let streamCompleted = false;
        const cleanup = () => { aborted = true; };
        req.on('close', cleanup);
        req.on('error', cleanup);

        try {
          if (!aborted && res.writable) {
            res.write(`data: ${JSON.stringify({ type: 'meta', requestId, repo, question })}\n\n`);
            metrics.incrementEventCount();
            res.write(`data: ${JSON.stringify({ type: 'delta', seq: 1, content: analyticsAnswer })}\n\n`);
            metrics.incrementEventCount();
            res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
            metrics.incrementEventCount();
            res.write(`data: [DONE]\n\n`);
            metrics.incrementEventCount();
            await setStreamSessionProgress(requestId, { lastSeq: 1, partialAnswer: analyticsAnswer });
            streamCompleted = true;
          }
        } catch (streamErr) {
          const errorMessage = streamErr instanceof Error ? streamErr.message : 'Stream error';
          const errorToRecord = streamErr instanceof Error ? streamErr : new Error(errorMessage);
          metrics.recordError(errorToRecord, categorizeError(errorToRecord));
          metrics.incrementErrorCount();
          await setStreamSessionProgress(requestId, { lastSeq: 0, partialAnswer: '' });

          if (res.writable) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`);
            metrics.incrementEventCount();
          }
        } finally {
          req.removeListener('close', cleanup);
          req.removeListener('error', cleanup);

          if (streamCompleted) {
            await deleteStreamSession(requestId);
          }

          logStreamMetrics(`[ask.ts analytics-stream] ${repo}`, metrics.end());
          res.end();
        }
        return;
      }

      return res.status(200).json({ answer: analyticsAnswer, sources });
    }

    // Fast-fail for repos that have not been indexed yet.
    const chunkCount = await countRepoChunks(repo);
    if (chunkCount === 0) {
      // If analytics data was fetched, let LLM format it even without RAG context
      if (analyticsContext) {
        const result = await generateAnswer(question, repo, [], analyticsContext);
        return res.status(200).json(result);
      }
      return res.status(200).json({
        answer: 'This repository has not been indexed yet. Please index it first before asking questions.',
        sources: [],
      });
    }

    // 1. Classify the query to determine type filter
    const { typeFilter, category } = classifyQuery(question);

    // 2. First-pass retrieval
    const t0 = Date.now();
    const firstPass = await hybridSearch(question, repo, 8, typeFilter);
    const firstPassMs = Date.now() - t0;

    if (firstPass.length === 0) {
      return res.status(200).json({
        answer: 'I could not find any relevant code or documentation in this repository for your question. Try rephrasing your question or adjusting any filters you are using.',
        sources: [],
      });
    }

    // 3. Analyze query + decide on rewrite
    const t1 = Date.now();
    const rewriteResult = await analyzeAndRewrite(question, category, firstPass, 'rerank_boosted');
    const rewriteDecisionMs = Date.now() - t1;
    const firstPassConfidence = computeConfidence(firstPass, 'rerank_boosted');

    // 4. Execute rewrite searches if needed, merge, rerank
    let chunks: ScoredChunk[];
    let rewriteSearchMs = 0;
    let mergedChunkCount = 0;
    let deduplicatedCount = 0;

    if (rewriteResult.decision.mode === 'none') {
      chunks = firstPass;
    } else {
      const t2 = Date.now();
      const rewritePasses = await Promise.all(
        rewriteResult.candidates.map((c) => hybridSearch(c.query, repo, 8, typeFilter)),
      );
      rewriteSearchMs = Date.now() - t2;

      const totalInputChunks = firstPass.length + rewritePasses.reduce((n, p) => n + p.length, 0);
      const merged = mergeResults(firstPass, rewritePasses, rewriteResult.candidates);
      mergedChunkCount = merged.length;
      deduplicatedCount = totalInputChunks - mergedChunkCount;
      const scoredForRerank = toScoredChunks(merged);
      chunks = rerank(scoredForRerank, question, 8);
    }

    // 5. Structured rewrite diagnostics
    const { before: beforeRewrite, after: afterRewrite } =
      rewriteResult.decision.mode !== 'none'
        ? buildDiagnosticSnapshots(firstPass, chunks, 8)
        : {
            before: {
              topScore: firstPass[0]?.score ?? 0,
              avgScore:
                firstPass.length > 0
                  ? firstPass.reduce((sum, c) => sum + (c.score ?? 0), 0) / firstPass.length
                  : 0,
              chunkIds: firstPass.map((c) => c.chunk.id),
              coverageRatio: 1,
            },
            after: null,
          };

    const diagnostics: RetrievalDiagnostics = {
      requestId: '', // set below if streaming
      originalQuery: question,
      repo,
      analysis: rewriteResult.analysis,
      firstPassConfidence,
      decision: rewriteResult.decision,
      candidates: rewriteResult.candidates,
      beforeRewrite,
      afterRewrite,
      timing: {
        totalRetrievalMs: firstPassMs + rewriteDecisionMs + rewriteSearchMs,
        firstPassMs,
        rewriteDecisionMs,
        rewriteSearchMs,
        llmRewriteMs: rewriteResult.decision.mode === 'strong-llm' ? rewriteDecisionMs : null,
        mergeMs: 0,
        rerankMs: 0,
      },
      counts: {
        firstPassChunks: firstPass.length,
        mergedChunks: mergedChunkCount,
        deduplicatedChunks: deduplicatedCount,
        finalChunks: chunks.length,
      },
    };

    // Log rewrite diagnostics as structured JSON
    console.log(JSON.stringify({
      type: 'rewrite_diagnostics',
      requestId: diagnostics.requestId,
      repo,
      mode: diagnostics.decision.mode,
      reasonCodes: diagnostics.decision.reasonCodes,
      rewriteScore: diagnostics.decision.rewriteScore,
      riskScore: diagnostics.analysis.riskScore,
      confidenceScore: firstPassConfidence.confidenceScore,
      anchorTypes: Object.entries(diagnostics.analysis.anchors)
        .filter(([, v]) => (v as string[]).length > 0)
        .map(([k]) => k),
      candidateCount: diagnostics.candidates.length,
      overlap: diagnostics.afterRewrite?.overlapRatio ?? null,
      newChunks: diagnostics.afterRewrite?.newChunkIds.length ?? 0,
      timing: diagnostics.timing,
      counts: diagnostics.counts,
    }));

    const wantStream = req.body?.stream === true;

    if (wantStream) {
      // --- Initialize metrics ---
      const metrics = new ServerMetricsRecorder();
      const requestId = metrics.getRequestId();
      metrics.setChunkCount(chunks.length);
      diagnostics.requestId = requestId;
      const sources = buildSources(chunks);
      const contextText = buildContextText(chunks);
      let answerSoFar = '';

      // Persist stream session for resume
      await setStreamSessionSnapshot({
        requestId,
        login: auth.login!,
        repo,
        question,
        createdAt: Date.now(),
        contextText,
        contextPrefix: analyticsContext || undefined,
        sources,
      });
      await setStreamSessionProgress(requestId, { lastSeq: 0, partialAnswer: '' });

      // --- SSE streaming with heartbeat, request ID, and metrics ---
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      res.setHeader('X-Request-ID', requestId); // request tracing

      // Send initial meta event for client correlation
      res.write(`data: ${JSON.stringify({ type: 'meta', requestId, repo, question })}\n\n`);
      metrics.incrementEventCount();

      let aborted = false;
      let heartbeatTimer: NodeJS.Timeout | undefined;
      let streamCompleted = false;
      const cleanup = () => { aborted = true; };
      req.on('close', cleanup);
      req.on('error', cleanup);

      let seq = 0;
      try {
        const generator = generateAnswerStream(question, repo, chunks, analyticsContext || undefined);

        // --- Heartbeat: send ping every 20s to prevent proxy timeout ---
        const startHeartbeat = () => {
          heartbeatTimer = setInterval(() => {
            if (!aborted && res.writable) {
              res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
              metrics.incrementEventCount();
            }
          }, 20000); // 20 seconds
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
          metrics.incrementEventCount();
          answerSoFar += delta;

          // Update session position every 10 deltas to allow resume
          if (seq % 10 === 0) {
            await setStreamSessionProgress(requestId, { lastSeq: seq, partialAnswer: answerSoFar });
          }

          res.write(`data: ${JSON.stringify({ type: 'delta', seq, content: delta })}\n\n`);
        }

        if (!aborted) {
          // Persist final position and mark stream as completed
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
          // Clean up the stream session once completed
          await deleteStreamSession(requestId);
        }

        const finalMetrics = metrics.end();
        logStreamMetrics(`[ask.ts stream] ${repo}`, finalMetrics);
        res.end();
      }
    } else {
      // --- Non-streaming (backwards compatible) ---
      const result = await generateAnswer(question, repo, chunks, analyticsContext || undefined);
      return res.status(200).json(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
