import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoredChunk } from '../../../../lib/rag/types.js';

const {
  mockIncrementAlertStreak,
  mockResetAlertStreak,
  mockCheckAndFireStreakAlert,
} = vi.hoisted(() => ({
  mockIncrementAlertStreak: vi.fn().mockResolvedValue(undefined),
  mockResetAlertStreak: vi.fn().mockResolvedValue(undefined),
  mockCheckAndFireStreakAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../lib/admin/alert-manager.js', () => ({
  incrementAlertStreak: mockIncrementAlertStreak,
  resetAlertStreak: mockResetAlertStreak,
  checkAndFireStreakAlert: mockCheckAndFireStreakAlert,
}));

import { codeFetchStage, extractCodeWindow, updateCodeFetchAlerts } from '../../../../lib/rag/code-fetch.js';
import * as fetchers from '../../../../lib/rag/github/fetchers.js';

function makeCodeChunk(path: string, symbolNames: string[] = [], score = 1): ScoredChunk {
  return {
    chunk: {
      id: `code:${path}`,
      content: `summary for ${path}`,
      metadata: {
        repo: 'owner/repo',
        type: 'code_summary',
        title: path,
        githubUrl: `https://github.com/owner/repo/blob/main/${path}`,
        filePath: path,
        symbolNames,
      },
    },
    score,
  };
}

function makeNonCodeChunk(): ScoredChunk {
  return {
    chunk: {
      id: 'readme:1',
      content: 'readme',
      metadata: {
        repo: 'owner/repo',
        type: 'readme',
        title: 'README',
        githubUrl: 'https://github.com/owner/repo#readme',
      },
    },
    score: 1,
  };
}

describe('extractCodeWindow', () => {
  it('prefers a symbol-centered window when a match exists', () => {
    const content = [
      'line 1',
      'line 2',
      'function retryHandler() {',
      '  return true',
      '}',
      'line 6',
    ].join('\n');

    const window = extractCodeWindow(content, ['retryHandler'], 200);

    expect(window).toContain('function retryHandler() {');
    expect(window.startsWith('line 1')).toBe(true);
  });

  it('falls back to the file head when no symbol matches', () => {
    const content = 'alpha\nbeta\ngamma\ndelta';
    const window = extractCodeWindow(content, ['missingSymbol'], 10);

    expect(window).toBe('alpha\nbeta');
  });
});

describe('codeFetchStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches code for code_summary hits and injects live source context', async () => {
    vi.spyOn(fetchers, 'fetchFileContentDetailed').mockResolvedValue({
      ok: true,
      content: 'export function retryHandler() {\n  return true;\n}',
    });

    const result = await codeFetchStage([
      makeCodeChunk('src/retry.ts', ['retryHandler']),
    ], 'owner/repo', 'token');

    expect(fetchers.fetchFileContentDetailed).toHaveBeenCalledWith('owner/repo', 'src/retry.ts', 'token');
    expect(result.fetchedFiles).toEqual(['src/retry.ts']);
    expect(result.usedSummaryOnlyFallback).toBe(false);
    expect(result.codeContext).toContain('Live source code');
    expect(result.codeContext).toContain('retryHandler');
  });

  it('falls back to summary-only when fetch fails', async () => {
    vi.spyOn(fetchers, 'fetchFileContentDetailed').mockResolvedValue({ ok: false, reason: 'forbidden' });

    const result = await codeFetchStage([
      makeCodeChunk('src/retry.ts', ['retryHandler']),
    ], 'owner/repo', 'token');

    expect(result.fetchedFiles).toEqual([]);
    expect(result.failedFiles).toEqual([{ path: 'src/retry.ts', reason: 'forbidden' }]);
    expect(result.usedSummaryOnlyFallback).toBe(true);
    expect(result.codeContext).toBe('');
  });

  it('treats too_large fetch results as skipped files without failing the main flow', async () => {
    vi.spyOn(fetchers, 'fetchFileContentDetailed').mockResolvedValue({ ok: false, reason: 'too_large' });

    const result = await codeFetchStage([
      makeCodeChunk('src/big-file.ts'),
    ], 'owner/repo', 'token');

    expect(result.failedFiles).toEqual([{ path: 'src/big-file.ts', reason: 'too_large' }]);
    expect(result.usedSummaryOnlyFallback).toBe(true);
  });

  it('does not trigger source fetch when there are no code_summary hits', async () => {
    const result = await codeFetchStage([makeNonCodeChunk()], 'owner/repo', 'token');

    expect(fetchers.fetchFileContentDetailed).not.toHaveBeenCalled();
    expect(result).toEqual({
      codeContext: '',
      fetchedFiles: [],
      failedFiles: [],
      usedSummaryOnlyFallback: true,
    });
  });
});

describe('updateCodeFetchAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments each alert streak at most once per request', async () => {
    await updateCodeFetchAlerts('owner/repo', [
      { path: 'src/a.ts', reason: 'timeout' },
      { path: 'src/b.ts', reason: 'timeout' },
      { path: 'src/c.ts', reason: 'forbidden' },
      { path: 'src/d.ts', reason: 'unknown' },
    ]);

    expect(mockIncrementAlertStreak).toHaveBeenCalledTimes(2);
    expect(mockIncrementAlertStreak).toHaveBeenCalledWith('timeout_streak', 'owner/repo');
    expect(mockIncrementAlertStreak).toHaveBeenCalledWith('code_fetch_failure_streak', 'owner/repo');
    expect(mockCheckAndFireStreakAlert).toHaveBeenCalledTimes(2);
    expect(mockResetAlertStreak).not.toHaveBeenCalled();
  });

  it('resets both streaks when the request has no failed files', async () => {
    await updateCodeFetchAlerts('owner/repo', []);

    expect(mockIncrementAlertStreak).not.toHaveBeenCalled();
    expect(mockResetAlertStreak).toHaveBeenCalledTimes(2);
    expect(mockResetAlertStreak).toHaveBeenCalledWith('timeout_streak', 'owner/repo');
    expect(mockResetAlertStreak).toHaveBeenCalledWith('code_fetch_failure_streak', 'owner/repo');
  });
});
