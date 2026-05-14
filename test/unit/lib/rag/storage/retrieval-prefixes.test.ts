import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIndex } = vi.hoisted(() => ({
  mockIndex: {
    range: vi.fn(),
  },
}));

vi.mock('@upstash/vector', () => ({
  Index: vi.fn(class MockIndex {
    constructor() {
      return mockIndex;
    }
  }),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(class MockRedis {}),
}));

import {
  fetchCodeSummaryChunks,
  fetchCoreRepoChunks,
} from '../../../../../lib/rag/storage/index.js';

describe('storage retrieval prefixes', () => {
  beforeEach(() => {
    process.env.UPSTASH_VECTOR_REST_URL = 'https://vector.test';
    process.env.UPSTASH_VECTOR_REST_TOKEN = 'token';
    vi.clearAllMocks();
    mockIndex.range.mockResolvedValue({ vectors: [], nextCursor: undefined });
  });

  it('normalizes repo casing for core prefix scans', async () => {
    await fetchCoreRepoChunks('Owner/Repo', ['readme']);

    expect(mockIndex.range).toHaveBeenCalledWith(expect.objectContaining({
      prefix: 'owner/repo:readme',
    }));
  });

  it('normalizes repo casing for code summary prefix scans', async () => {
    await fetchCodeSummaryChunks('Owner/Repo');

    expect(mockIndex.range).toHaveBeenCalledWith(expect.objectContaining({
      prefix: 'owner/repo:code:',
    }));
  });
});
