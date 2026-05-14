import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  vectorSearch: vi.fn(),
  keywordSearch: vi.fn(),
  rerank: vi.fn(),
}));

vi.mock('../../../../../lib/rag/retrieval/vector.js', () => ({
  vectorSearch: mocks.vectorSearch,
}));

vi.mock('../../../../../lib/rag/retrieval/keyword.js', () => ({
  keywordSearch: mocks.keywordSearch,
}));

vi.mock('../../../../../lib/rag/retrieval/rerank.js', () => ({
  rerank: mocks.rerank,
}));

import { hybridSearch } from '../../../../../lib/rag/retrieval/hybrid.js';

describe('hybridSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vectorSearch.mockResolvedValue([]);
    mocks.keywordSearch.mockResolvedValue([]);
    mocks.rerank.mockResolvedValue([]);
  });

  it('expands backend fetch width when topK exceeds the default candidate width', async () => {
    await hybridSearch('query', 'owner/repo', 15);

    expect(mocks.vectorSearch).toHaveBeenCalledWith('query', 'owner/repo', 30, undefined, undefined);
    expect(mocks.keywordSearch).toHaveBeenCalledWith('query', 'owner/repo', 30, undefined, undefined);
  });
});
