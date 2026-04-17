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

  it('merges new feedback into the existing feedback payload', async () => {
    mockRedis.hget.mockResolvedValueOnce(JSON.stringify({
      thumbsUp: true,
      userRetried: true,
      timestamp: 100,
    }));

    await writeEvalFeedback('req_123', { shareCreated: true, shareId: 'share_1' });

    expect(mockRedis.hget).toHaveBeenCalledWith('rag:eval:req_123', 'feedback');
    expect(mockRedis.hset).toHaveBeenCalledTimes(1);

    const payload = mockRedis.hset.mock.calls[0][1] as { feedback: string };
    const parsed = JSON.parse(payload.feedback) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      thumbsUp: true,
      userRetried: true,
      shareCreated: true,
      shareId: 'share_1',
    });
    expect(typeof parsed.timestamp).toBe('number');
    expect(parsed.timestamp).not.toBe(100);
    expect(mockRedis.expire).toHaveBeenCalledWith('rag:eval:req_123', 60 * 60 * 48);
  });

  it('falls back to the new payload when existing feedback is malformed', async () => {
    mockRedis.hget.mockResolvedValueOnce('not-json');

    await writeEvalFeedback('req_123', { thumbsDown: true });

    const payload = mockRedis.hset.mock.calls[0][1] as { feedback: string };
    const parsed = JSON.parse(payload.feedback) as Record<string, unknown>;
    expect(parsed).toMatchObject({ thumbsDown: true });
    expect(typeof parsed.timestamp).toBe('number');
  });
});
