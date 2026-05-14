import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  embedText: vi.fn(),
  queryVectors: vi.fn(),
}));

vi.mock('../../../../../lib/rag/embeddings/index.js', () => ({
  embedText: mocks.embedText,
}));

vi.mock('../../../../../lib/rag/storage/index.js', () => ({
  normalizeRepo: (repo: string) => repo.toLowerCase(),
  queryVectors: mocks.queryVectors,
}));

import { vectorSearch } from '../../../../../lib/rag/retrieval/vector.js';

describe('vectorSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
    mocks.queryVectors.mockResolvedValue([]);
  });

  it('excludes code_summary vectors for non-code queries without an explicit type filter', async () => {
    await vectorSearch('how do I configure auth', 'Owner/Repo', 20, undefined, 'general');

    expect(mocks.queryVectors).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      20,
      "repo = 'owner/repo' AND type != 'code_summary'",
    );
  });

  it('preserves explicit type filters for code queries', async () => {
    await vectorSearch('where is retryHandler defined', 'Owner/Repo', 20, ['code_summary'], 'code');

    expect(mocks.queryVectors).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      20,
      "repo = 'owner/repo' AND type IN ('code_summary')",
    );
  });
});
