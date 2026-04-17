import type { VercelRequest, VercelResponse } from '@vercel/node';
import { classifyQuery } from '../../lib/rag/retrieval/router.js';
import { hybridSearch } from '../../lib/rag/retrieval/hybrid.js';
import {
  generateAnswer,
  generateAnswerStream,
  buildSources,
  buildContextText,
} from '../../lib/rag/llm/index.js';
import { authenticateRequest, checkRateLimit } from '../../lib/rag/auth/index.js';
import {
  countRepoChunks,
  setStreamSessionSnapshot,
  setStreamSessionProgress,
  deleteStreamSession,
  writeEvalEvent,
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
import { fetchFileContentDetailed } from '../../lib/rag/github/fetchers.js';
import {
  incrementAlertStreak,
  resetAlertStreak,
  checkAndFireStreakAlert,
} from '../../lib/admin/alert-manager.js';

// ═══ Code Fetch Stage ════════════════════════════════════════════

const CODE_FETCH_MAX_FILES = 3;
const CODE_FETCH_PER_FILE_CHARS = 2500;
const CODE_FETCH_TOTAL_CHARS = 6000;
const CODE_FETCH_TIMEOUT_MS = 3000;

interface CodeFetchResult {
  codeContext: string;
  fetchedFiles: string[];
  failedFiles: Array<{ path: string; reason: string }>;
  usedSummaryOnlyFallback: boolean;
}

/** Extract a window of code around a symbol match, or return file head */
export function extractCodeWindow(content: string, symbolNames: string[], maxChars: number): string {
  // Try to find a symbol match and extract surrounding context
  for (const symbol of symbolNames) {
    const idx = content.indexOf(symbol);
    if (idx === -1) continue;

    // Find line boundaries around the match
    const lines = content.split('\n');
    let currentPos = 0;
    let matchLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (currentPos + lines[i].length >= idx) {
        matchLine = i;
        break;
      }
      currentPos += lines[i].length + 1;
    }

    // Extract window: 50 lines before, 100 lines after
    const startLine = Math.max(0, matchLine - 50);
    const endLine = Math.min(lines.length, matchLine + 100);
    const window = lines.slice(startLine, endLine).join('\n');
    return window.slice(0, maxChars);
  }

  // No symbol match — return file head
  return content.slice(0, maxChars);
}

/** Fetch actual source code for code_summary chunks to enrich the answer context */
export async function codeFetchStage(
  chunks: ScoredChunk[],
  repo: string,
  token: string,
): Promise<CodeFetchResult> {
  // Collect candidate files from code_summary chunks
  const candidates: Array<{ path: string; symbolNames: string[]; score: number }> = [];
  for (const sc of chunks) {
    const m = sc.chunk.metadata;
    if (m.type === 'code_summary' && m.filePath) {
      candidates.push({
        path: m.filePath,
        symbolNames: m.symbolNames ?? [],
        score: sc.score,
      });
    }
  }

  if (candidates.length === 0) {
    return { codeContext: '', fetchedFiles: [], failedFiles: [], usedSummaryOnlyFallback: true };
  }

  // Take top N by score (already sorted from rerank)
  const selected = candidates.slice(0, CODE_FETCH_MAX_FILES);

  const fetchedFiles: string[] = [];
  const failedFiles: Array<{ path: string; reason: string }> = [];
  const codeBlocks: string[] = [];
  let totalChars = 0;

  // Fetch with overall timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CODE_FETCH_TIMEOUT_MS);

  try {
    const results = await Promise.all(
      selected.map(async (candidate) => {
        if (controller.signal.aborted) {
          failedFiles.push({ path: candidate.path, reason: 'timeout' });
          return null;
        }
        try {
          const fetched = await fetchFileContentDetailed(repo, candidate.path, token);
          if (!fetched.ok) {
            failedFiles.push({ path: candidate.path, reason: fetched.reason });
            return null;
          }
          return { ...candidate, content: fetched.content };
        } catch (fetchErr) {
          const reason = fetchErr instanceof Error && fetchErr.name === 'AbortError'
            ? 'timeout'
            : 'unknown';
          failedFiles.push({ path: candidate.path, reason });
          return null;
        }
      }),
    );

    for (const result of results) {
      if (!result) continue;
      if (totalChars >= CODE_FETCH_TOTAL_CHARS) break;

      const remaining = CODE_FETCH_TOTAL_CHARS - totalChars;
      const maxChars = Math.min(CODE_FETCH_PER_FILE_CHARS, remaining);
      const window = extractCodeWindow(result.content, result.symbolNames, maxChars);

      codeBlocks.push(`--- ${result.path} ---\n${window}`);
      fetchedFiles.push(result.path);
      totalChars += window.length;
    }
  } finally {
    clearTimeout(timeout);
  }

  if (codeBlocks.length === 0) {
    return { codeContext: '', fetchedFiles: [], failedFiles, usedSummaryOnlyFallback: true };
  }

  const codeContext = `[Live source code — prefer this over summaries when answering implementation questions]\n\n${codeBlocks.join('\n\n')}`;
  return { codeContext, fetchedFiles, failedFiles, usedSummaryOnlyFallback: false };
}

export async function updateCodeFetchAlerts(
  repo: string,
  failedFiles: Array<{ path: string; reason: string }>,
): Promise<void> {
  const hasTimeoutFailure = failedFiles.some((f) => f.reason === 'timeout');
  const hasGeneralFailure = failedFiles.some((f) =>
    f.reason === 'not_found' ||
    f.reason === 'forbidden' ||
    f.reason === 'rate_limited' ||
    f.reason === 'unknown',
  );

  if (hasTimeoutFailure) {
    try {
      await incrementAlertStreak('timeout_streak', repo);
      await checkAndFireStreakAlert('timeout_streak', repo, 5, { repo });
    } catch {
      // best-effort
    }
  } else {
    try {
      await resetAlertStreak('timeout_streak', repo);
    } catch {
      // best-effort
    }
  }

  if (hasGeneralFailure) {
    try {
      await incrementAlertStreak('code_fetch_failure_streak', repo);
      await checkAndFireStreakAlert('code_fetch_failure_streak', repo, 5, { repo });
    } catch {
      // best-effort
    }
  } else {
    try {
      await resetAlertStreak('code_fetch_failure_streak', repo);
    } catch {
      // best-effort
    }
  }
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

  if (!auth.token) {
    return res.status(401).json({ error: 'Missing GitHub access token in authenticated session.' });
  }

  const token = auth.token;

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

        let aborted = false;
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
          }
        } catch (streamErr) {
          const errorMessage = streamErr instanceof Error ? streamErr.message : 'Stream error';
          const errorToRecord = streamErr instanceof Error ? streamErr : new Error(errorMessage);
          metrics.recordError(errorToRecord, categorizeError(errorToRecord));
          metrics.incrementErrorCount();

          if (res.writable) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`);
            metrics.incrementEventCount();
          }
        } finally {
          req.removeListener('close', cleanup);
          req.removeListener('error', cleanup);

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
    const firstPass = await hybridSearch(question, repo, 8, typeFilter, category);
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
        rewriteResult.candidates.map((c) => hybridSearch(c.query, repo, 8, typeFilter, category)),
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

    // 6. Code fetch stage — only for code queries with code_summary hits
    let codeContextPrefix = '';
    let codeFetchResult: CodeFetchResult | null = null;
    if (category === 'code') {
      try {
        codeFetchResult = await codeFetchStage(chunks, repo, token);
        if (codeFetchResult.codeContext) {
          codeContextPrefix = codeFetchResult.codeContext + '\n\n';
        }
        if (codeFetchResult.fetchedFiles.length > 0 || codeFetchResult.failedFiles.length > 0) {
          console.log(JSON.stringify({
            type: 'code_fetch',
            repo,
            fetchedFiles: codeFetchResult.fetchedFiles,
            failedFiles: codeFetchResult.failedFiles,
            usedSummaryOnlyFallback: codeFetchResult.usedSummaryOnlyFallback,
          }));
        }

        await updateCodeFetchAlerts(repo, codeFetchResult.failedFiles);
      } catch (codeFetchErr) {
        console.log(JSON.stringify({
          type: 'code_fetch_error',
          repo,
          error: codeFetchErr instanceof Error ? codeFetchErr.message : 'Unknown error',
        }));
        // Degrade gracefully — answer from summaries only
      }
    }

    // Merge code context with analytics context
    const fullContextPrefix = codeContextPrefix + (analyticsContext || '');

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
        contextPrefix: fullContextPrefix || undefined,
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
        const generator = generateAnswerStream(question, repo, chunks, fullContextPrefix || undefined);

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

        // Best-effort eval writes (fire-and-forget)
        void writeEvalEvent(requestId, 'retrieval', {
          repo, login: auth.login, category, queryCategory: category,
          rewriteMode: rewriteResult.decision.mode,
          firstPassCount: firstPass.length, finalCount: chunks.length,
          topScore: firstPassConfidence.topScore, avgScore: firstPassConfidence.avgScore,
          coverageRatio: firstPassConfidence.coverageRatio,
          totalRetrievalMs: diagnostics.timing.totalRetrievalMs,
        });
        if (codeFetchResult) {
          void writeEvalEvent(requestId, 'code_fetch', {
            repo, login: auth.login,
            fetchedFiles: codeFetchResult.fetchedFiles,
            failedFiles: codeFetchResult.failedFiles,
            summaryOnlyFallback: codeFetchResult.usedSummaryOnlyFallback,
            usedSummaryOnlyFallback: codeFetchResult.usedSummaryOnlyFallback,
          });
        }
        void writeEvalEvent(requestId, 'answer', {
          repo, login: auth.login,
          answerLength: answerSoFar.length,
          sourceCount: sources.length,
          usedRetrievedCode: codeContextPrefix.length > 0,
          hasCodeContext: codeContextPrefix.length > 0,
          streamCancelled: aborted,
        });

        res.end();
      }
    } else {
      // --- Non-streaming (backwards compatible) ---
      const result = await generateAnswer(question, repo, chunks, fullContextPrefix || undefined);

      // Best-effort eval writes
      const evalRequestId = `non-stream-${Date.now()}`;
      void writeEvalEvent(evalRequestId, 'retrieval', {
        repo, login: auth.login, category, queryCategory: category,
        rewriteMode: rewriteResult.decision.mode,
        firstPassCount: firstPass.length, finalCount: chunks.length,
        topScore: firstPassConfidence.topScore, avgScore: firstPassConfidence.avgScore,
      });
      if (codeFetchResult) {
        void writeEvalEvent(evalRequestId, 'code_fetch', {
          repo, login: auth.login,
          fetchedFiles: codeFetchResult.fetchedFiles,
          failedFiles: codeFetchResult.failedFiles,
          summaryOnlyFallback: codeFetchResult.usedSummaryOnlyFallback,
          usedSummaryOnlyFallback: codeFetchResult.usedSummaryOnlyFallback,
        });
      }
      void writeEvalEvent(evalRequestId, 'answer', {
        repo, login: auth.login,
        answerLength: result.answer.length,
        sourceCount: result.sources.length,
        usedRetrievedCode: codeContextPrefix.length > 0,
        hasCodeContext: codeContextPrefix.length > 0,
        streamCancelled: false,
      });

      return res.status(200).json(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
