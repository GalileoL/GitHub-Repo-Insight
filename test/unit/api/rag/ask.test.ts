import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoredChunk } from '../../../../lib/rag/types.js';

import { codeFetchStage, extractCodeWindow } from '../../../../api/rag/ask.js';
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
