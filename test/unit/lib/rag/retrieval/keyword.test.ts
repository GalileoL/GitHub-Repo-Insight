import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoredChunk } from '../../../../../lib/rag/types.js';

const {
  fetchCoreRepoChunksMock,
  fetchCodeSummaryChunksMock,
  fetchAllRepoChunksMock,
} = vi.hoisted(() => ({
  fetchCoreRepoChunksMock: vi.fn(),
  fetchCodeSummaryChunksMock: vi.fn(),
  fetchAllRepoChunksMock: vi.fn(),
}));

vi.mock('../../../../../lib/rag/storage/index.js', () => ({
  fetchCoreRepoChunks: fetchCoreRepoChunksMock,
  fetchCodeSummaryChunks: fetchCodeSummaryChunksMock,
  fetchAllRepoChunks: fetchAllRepoChunksMock,
}));

import { keywordSearch } from '../../../../../lib/rag/retrieval/keyword.js';

function makeChunk(id: string, type: ScoredChunk['chunk']['metadata']['type'], title: string, content: string): ScoredChunk {
  return {
    chunk: {
      id,
      content,
      metadata: {
        repo: 'owner/repo',
        type,
        title,
        githubUrl: `https://github.com/owner/repo/${id}`,
      },
    },
    score: 1,
  };
}

describe('keywordSearch K1/K2 isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCoreRepoChunksMock.mockResolvedValue([]);
    fetchCodeSummaryChunksMock.mockResolvedValue([]);
    fetchAllRepoChunksMock.mockResolvedValue([]);
  });

  it('uses the explicit documentation filter from production routing', async () => {
    fetchCoreRepoChunksMock.mockResolvedValue([
      makeChunk('readme-1', 'readme', 'Setup Guide', 'install setup getting started'),
    ]);

    const results = await keywordSearch(
      'install setup',
      'owner/repo',
      5,
      ['readme', 'release'],
      'documentation',
    );

    expect(fetchCoreRepoChunksMock).toHaveBeenCalledWith('owner/repo', ['readme', 'release']);
    expect(fetchCodeSummaryChunksMock).not.toHaveBeenCalled();
    expect(fetchAllRepoChunksMock).not.toHaveBeenCalled();
    expect(results.map((item) => item.chunk.id)).toEqual(['readme-1']);
  });

  it('uses the mixed code filter from production routing', async () => {
    fetchCoreRepoChunksMock.mockResolvedValue([
      makeChunk('commit-1', 'commit', 'Recent auth changes', 'retry handler moved'),
      makeChunk('readme-1', 'readme', 'Architecture', 'retry overview'),
    ]);
    fetchCodeSummaryChunksMock.mockResolvedValue([
      makeChunk('code-1', 'code_summary', 'src/auth/retry.ts', 'retry handler implementation'),
    ]);

    const results = await keywordSearch(
      'retry handler',
      'owner/repo',
      5,
      ['code_summary', 'pr', 'commit', 'readme'],
      'code',
    );

    expect(fetchCoreRepoChunksMock).toHaveBeenCalledWith('owner/repo', ['pr', 'commit', 'readme']);
    expect(fetchCodeSummaryChunksMock).toHaveBeenCalledWith('owner/repo');
    expect(fetchAllRepoChunksMock).not.toHaveBeenCalled();
    expect(results.map((item) => item.chunk.id)).toContain('code-1');
    expect(results.map((item) => item.chunk.id)).toContain('commit-1');
  });

  it('honors explicit typeFilter over queryCategory', async () => {
    fetchCoreRepoChunksMock.mockResolvedValue([
      makeChunk('readme-1', 'readme', 'README', 'project overview'),
    ]);
    fetchCodeSummaryChunksMock.mockResolvedValue([
      makeChunk('code-1', 'code_summary', 'src/router.ts', 'classifyQuery implementation'),
    ]);

    const results = await keywordSearch('classifyQuery', 'owner/repo', 5, ['code_summary'], 'documentation');

    expect(fetchCoreRepoChunksMock).not.toHaveBeenCalled();
    expect(fetchCodeSummaryChunksMock).toHaveBeenCalledWith('owner/repo');
    expect(results.map((item) => item.chunk.id)).toEqual(['code-1']);
  });

  it('keeps production general queries on core chunks only', async () => {
    fetchCoreRepoChunksMock.mockResolvedValue([
      makeChunk('issue-1', 'issue', 'General issue', 'general context'),
    ]);

    const results = await keywordSearch('general context', 'owner/repo', 5, undefined, 'general');

    expect(fetchCoreRepoChunksMock).toHaveBeenCalledWith('owner/repo');
    expect(fetchCodeSummaryChunksMock).not.toHaveBeenCalled();
    expect(fetchAllRepoChunksMock).not.toHaveBeenCalled();
    expect(results.map((item) => item.chunk.id)).toEqual(['issue-1']);
  });

  it('falls back to fetchAllRepoChunks only when category is truly unknown', async () => {
    fetchAllRepoChunksMock.mockResolvedValue([
      makeChunk('issue-1', 'issue', 'General issue', 'general context'),
    ]);

    const results = await keywordSearch('general context', 'owner/repo', 5, undefined, undefined);

    expect(fetchAllRepoChunksMock).toHaveBeenCalledWith('owner/repo');
    expect(fetchCoreRepoChunksMock).not.toHaveBeenCalled();
    expect(fetchCodeSummaryChunksMock).not.toHaveBeenCalled();
    expect(results.map((item) => item.chunk.id)).toEqual(['issue-1']);
  });
});
