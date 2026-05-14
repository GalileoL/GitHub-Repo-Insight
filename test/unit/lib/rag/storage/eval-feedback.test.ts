import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    hget: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
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

import { writeEvalFeedback } from '../../../../../lib/rag/storage/index.js';

describe('writeEvalFeedback', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    vi.clearAllMocks();
  });

  it('writes feedback as independent hash fields so signals do not overwrite each other', async () => {
    await expect(writeEvalFeedback('req_123', { shareCreated: true, shareId: 'share_1' })).resolves.toBe(true);

    expect(mockRedis.hget).not.toHaveBeenCalled();
    expect(mockRedis.hset).toHaveBeenCalledTimes(1);

    const payload = mockRedis.hset.mock.calls[0][1] as Record<string, string>;
    expect(payload).toMatchObject({
      'feedback:shareCreated': 'true',
      'feedback:shareId': '"share_1"',
    });
    expect(Number(payload['feedback:timestamp'])).toBeGreaterThan(0);
    expect(mockRedis.expire).toHaveBeenCalledWith('rag:eval:req_123', 60 * 60 * 48);
  });

  it('issues separate atomic hset calls for concurrent feedback updates', async () => {
    await Promise.all([
      writeEvalFeedback('req_123', { thumbsUp: true }),
      writeEvalFeedback('req_123', { shareCreated: true }),
    ]);

    expect(mockRedis.hset).toHaveBeenCalledTimes(2);
    expect(mockRedis.hset.mock.calls[0][1]).toMatchObject({ 'feedback:thumbsUp': 'true' });
    expect(mockRedis.hset.mock.calls[1][1]).toMatchObject({ 'feedback:shareCreated': 'true' });
  });

  it('returns false when feedback storage fails', async () => {
    mockRedis.hset.mockRejectedValueOnce(new Error('redis down'));

    await expect(writeEvalFeedback('req_123', { thumbsUp: true })).resolves.toBe(false);
  });
});
