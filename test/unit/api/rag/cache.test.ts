import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as storage from '../../../../lib/rag/storage/index.js';
import * as auth from '../../../../lib/rag/auth/index.js';

import shareHandler from '../../../../api/rag/share/[id].js';
import statusHandler from '../../../../api/rag/status.js';
import sessionHandler from '../../../../api/auth/session.js';

type MockReq = {
  method?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
};

type MockRes = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  ended: boolean;
  setHeader: (name: string, value: string | string[]) => void;
  getHeader: (name: string) => string | string[] | undefined;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  end: () => MockRes;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe('rag cache headers and conditional responses', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 304 for share endpoint when ETag matches', async () => {
    vi.spyOn(storage, 'getShareEntry').mockResolvedValue({
      id: 'share-1',
      repo: 'owner/repo',
      question: 'q',
      answer: 'a',
      sources: [],
      createdAt: 1_700_000_000_000,
    });

    const req: MockReq = {
      method: 'GET',
      query: { id: 'share-1' },
      headers: { 'if-none-match': '"share-share-1-1700000000000"' },
    };
    const res = createMockRes();

    await shareHandler(req as never, res as never);

    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.getHeader('ETag')).toBe('"share-share-1-1700000000000"');
  });

  it('returns 304 for share endpoint when If-Modified-Since is current', async () => {
    vi.spyOn(storage, 'getShareEntry').mockResolvedValue({
      id: 'share-1',
      repo: 'owner/repo',
      question: 'q',
      answer: 'a',
      sources: [],
      createdAt: 1_700_000_000_000,
    });

    const req: MockReq = {
      method: 'GET',
      query: { id: 'share-1' },
      headers: { 'if-modified-since': new Date(1_700_000_000_000).toUTCString() },
    };
    const res = createMockRes();

    await shareHandler(req as never, res as never);

    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
  });

  it('returns 405 for share endpoint on non-GET requests', async () => {
    const req: MockReq = {
      method: 'POST',
      query: { id: 'share-1' },
      headers: {},
    };
    const res = createMockRes();

    await shareHandler(req as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 304 for status endpoint when ETag matches', async () => {
    vi.spyOn(storage, 'countRepoChunks').mockResolvedValue(12);

    const req: MockReq = {
      method: 'GET',
      query: { repo: 'Owner/Repo' },
      headers: { 'if-none-match': '"status-owner/repo-12"' },
    };
    const res = createMockRes();

    await statusHandler(req as never, res as never);

    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.getHeader('ETag')).toBe('"status-owner/repo-12"');
  });

  it('returns 405 for status endpoint on non-GET requests', async () => {
    const req: MockReq = {
      method: 'POST',
      query: { repo: 'owner/repo' },
      headers: {},
    };
    const res = createMockRes();

    await statusHandler(req as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('sets no-store header for auth session endpoint', async () => {
    vi.spyOn(auth, 'getSessionUser').mockReturnValue(null);

    const req: MockReq = {
      method: 'GET',
      query: {},
      headers: {},
    };
    const res = createMockRes();

    await sessionHandler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('Cache-Control')).toBe('private, no-store');
    expect(res.body).toEqual({ authenticated: false, user: null });
  });

  it('returns 405 for auth session endpoint on non-GET requests', async () => {
    const req: MockReq = {
      method: 'POST',
      query: {},
      headers: {},
    };
    const res = createMockRes();

    await sessionHandler(req as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.getHeader('Cache-Control')).toBe('private, no-store');
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });
});
