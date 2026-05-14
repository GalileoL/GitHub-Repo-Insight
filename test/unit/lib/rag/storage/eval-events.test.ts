import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    hgetall: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(class MockRedis {
    constructor() {
      return mockRedis;
    }
  }),
}));

vi.mock('@upstash/vector', () => ({
  Index: vi.fn(class MockIndex {}),
}));

import {
  getEvalFields,
  writeEvalEventBatch,
} from '../../../../../lib/rag/storage/index.js';

describe('eval event storage helpers', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    vi.clearAllMocks();
  });

  it('indexes the request before writing a batched eval hash', async () => {
    await writeEvalEventBatch('req_123', {
      retrieval: { login: 'alice', category: 'code' },
      answer: { answerLength: 42 },
    });

    expect(mockRedis.sadd).toHaveBeenCalledTimes(1);
    expect(mockRedis.hset).toHaveBeenCalledTimes(1);
    expect(mockRedis.sadd.mock.invocationCallOrder[0]).toBeLessThan(
      mockRedis.hset.mock.invocationCallOrder[0],
    );

    const payload = mockRedis.hset.mock.calls[0][1] as Record<string, string>;
    expect(JSON.parse(payload.retrieval)).toMatchObject({ login: 'alice', category: 'code' });
    expect(JSON.parse(payload.answer)).toMatchObject({ answerLength: 42 });
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('returns only requested eval fields', async () => {
    mockRedis.hgetall.mockResolvedValue({
      retrieval: JSON.stringify({ login: 'alice' }),
      answer: JSON.stringify({ answerLength: 42 }),
      'feedback:thumbsUp': 'true',
    });

    const fields = await getEvalFields('req_123', ['retrieval']);

    expect(fields).toEqual({
      retrieval: JSON.stringify({ login: 'alice' }),
    });
  });

  it('rolls back the index entry when the batched hash write fails', async () => {
    mockRedis.hset.mockRejectedValueOnce(new Error('hset failed'));

    await writeEvalEventBatch('req_123', {
      retrieval: { login: 'alice' },
    });

    expect(mockRedis.sadd).toHaveBeenCalledTimes(1);
    expect(mockRedis.srem).toHaveBeenCalledTimes(1);
  });

  it('keeps the index entry when only TTL refresh fails after a successful hash write', async () => {
    mockRedis.expire
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('expire failed'));

    await writeEvalEventBatch('req_123', {
      retrieval: { login: 'alice' },
    });

    expect(mockRedis.hset).toHaveBeenCalledTimes(1);
    expect(mockRedis.srem).not.toHaveBeenCalled();
  });

  it('returns null when eval field hydration fails unexpectedly', async () => {
    mockRedis.hgetall.mockRejectedValueOnce(new Error('redis down'));

    const fields = await getEvalFields('req_123', ['retrieval']);

    expect(fields).toBeNull();
  });
});
