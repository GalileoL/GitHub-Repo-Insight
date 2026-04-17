import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as auth from '../../../../lib/rag/auth/index.js';
import * as storage from '../../../../lib/rag/storage/index.js';

import feedbackHandler from '../../../../api/rag/feedback.js';

type MockReq = {
  method?: string;
  body?: Record<string, unknown>;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('POST /api/rag/feedback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes thumbs/retry feedback to eval storage', async () => {
    vi.spyOn(auth, 'authenticateRequest').mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: 'token',
    });
    const writeEvalFeedback = vi.spyOn(storage, 'writeEvalFeedback').mockResolvedValue();

    const req: MockReq = {
      method: 'POST',
      body: {
        requestId: 'req_123',
        thumbsUp: true,
        userRetried: true,
      },
    };
    const res = createMockRes();

    await feedbackHandler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeEvalFeedback).toHaveBeenCalledWith(
      'req_123',
      expect.objectContaining({ thumbsUp: true, userRetried: true }),
    );
  });

  it('rejects requests without a requestId', async () => {
    vi.spyOn(auth, 'authenticateRequest').mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: 'token',
    });

    const req: MockReq = {
      method: 'POST',
      body: {
        thumbsDown: true,
      },
    };
    const res = createMockRes();

    await feedbackHandler(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing requestId' });
  });
});
