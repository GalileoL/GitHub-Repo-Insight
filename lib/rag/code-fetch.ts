import { fetchFileContentDetailed } from './github/fetchers.js';
import type { ScoredChunk } from './types.js';
import {
  incrementAlertStreak,
  resetAlertStreak,
  checkAndFireStreakAlert,
} from '../admin/alert-manager.js';

const CODE_FETCH_MAX_FILES = 3;
const CODE_FETCH_PER_FILE_CHARS = 2500;
const CODE_FETCH_TOTAL_CHARS = 6000;
const CODE_FETCH_TIMEOUT_MS = 3000;

export interface CodeFetchResult {
  codeContext: string;
  fetchedFiles: string[];
  failedFiles: Array<{ path: string; reason: string }>;
  usedSummaryOnlyFallback: boolean;
}

/** Extract a window of code around a symbol match, or return file head. */
export function extractCodeWindow(content: string, symbolNames: string[], maxChars: number): string {
  for (const symbol of symbolNames) {
    const idx = content.indexOf(symbol);
    if (idx === -1) continue;

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

    const startLine = Math.max(0, matchLine - 50);
    const endLine = Math.min(lines.length, matchLine + 100);
    return lines.slice(startLine, endLine).join('\n').slice(0, maxChars);
  }

  return content.slice(0, maxChars);
}

/** Fetch actual source code for code_summary chunks to enrich answer context. */
export async function codeFetchStage(
  chunks: ScoredChunk[],
  repo: string,
  token: string,
): Promise<CodeFetchResult> {
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

  const selected = candidates.slice(0, CODE_FETCH_MAX_FILES);
  const fetchedFiles: string[] = [];
  const failedFiles: Array<{ path: string; reason: string }> = [];
  const codeBlocks: string[] = [];
  let totalChars = 0;

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
          const fetched = await fetchFileContentDetailed(repo, candidate.path, token, {
            signal: controller.signal,
          });
          if (fetched.ok) {
            return { ...candidate, content: fetched.content };
          }
          failedFiles.push({ path: candidate.path, reason: fetched.reason });
          return null;
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

  const codeContext =
    `[Live source code — prefer this over summaries when answering implementation questions]\n\n${codeBlocks.join('\n\n')}`;
  return { codeContext, fetchedFiles, failedFiles, usedSummaryOnlyFallback: false };
}

export async function updateCodeFetchAlerts(
  repo: string,
  result:
    | Pick<CodeFetchResult, 'fetchedFiles' | 'failedFiles'>
    | Array<{ path: string; reason: string }>,
): Promise<void> {
  const fetchedFiles = Array.isArray(result) ? [] : result.fetchedFiles;
  const failedFiles = Array.isArray(result) ? result : result.failedFiles;
  const madeProgress = fetchedFiles.length > 0;
  const hasTimeoutFailure = failedFiles.some((f) => f.reason === 'timeout');
  const hasGeneralFailure = failedFiles.some((f) =>
    f.reason === 'not_found' ||
    f.reason === 'forbidden' ||
    f.reason === 'rate_limited' ||
    f.reason === 'unknown',
  );

  if (hasTimeoutFailure && !madeProgress) {
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

  if (hasGeneralFailure && !madeProgress) {
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
