import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAggregateDailyMetrics, mockSendOpsNotification } = vi.hoisted(() => ({
  mockAggregateDailyMetrics: vi.fn(),
  mockSendOpsNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../lib/admin/metrics-aggregator.js', () => ({
  aggregateDailyMetrics: mockAggregateDailyMetrics,
}));

vi.mock('../../../../lib/admin/report-renderer.js', () => ({
  renderDailyReport: vi.fn().mockReturnValue('# Daily Report'),
}));

vi.mock('../../../../lib/admin/notifier.js', () => ({
  sendOpsNotification: mockSendOpsNotification,
}));

import handler from '../../../../api/admin/report.js';

type MockReq = {
  method?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  ended: boolean;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
  return res;
}

const EMPTY_METRICS = {
  date: '2026-04-18',
  totalRequests: 0,
  categoryDistribution: {},
  codeFetchTriggerRate: 0,
  fetchSuccessRate: 0,
  summaryOnlyFallbackRate: 0,
  topSelectedFiles: [],
  failureReasonDistribution: {},
  answerUsedRetrievedCodeRatio: 0,
};

describe('api/admin/report', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.CRON_SECRET = 'supersecret';
    vi.clearAllMocks();
    mockAggregateDailyMetrics.mockResolvedValue(EMPTY_METRICS);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns 405 for non-GET requests', async () => {
    const req: MockReq = {
      method: 'POST',
      headers: { authorization: 'Bearer supersecret' },
      query: {},
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 500 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;

    const req: MockReq = {
      method: 'GET',
      headers: { authorization: 'Bearer something' },
      query: {},
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(500);
    expect((res.body as Record<string, string>).error).toMatch(/CRON_SECRET/);
  });

  it('returns 401 when authorization header is missing', async () => {
    const req: MockReq = {
      method: 'GET',
      headers: {},
      query: {},
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when wrong secret is provided', async () => {
    const req: MockReq = {
      method: 'GET',
      headers: { authorization: 'Bearer wrongsecret' },
      query: {},
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid date format', async () => {
    const req: MockReq = {
      method: 'GET',
      headers: { authorization: 'Bearer supersecret' },
      query: { date: 'not-a-date' },
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, string>).error).toMatch(/Invalid date/);
  });

  it('returns 200 with ok and metrics for valid request', async () => {
    const req: MockReq = {
      method: 'GET',
      headers: { authorization: 'Bearer supersecret' },
      query: { date: '2026-04-18' },
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, metrics: EMPTY_METRICS });
    expect(mockAggregateDailyMetrics).toHaveBeenCalledWith('2026-04-18');
    expect(mockSendOpsNotification).toHaveBeenCalledOnce();
  });

  it('returns 200 using today date when no date query param provided', async () => {
    const req: MockReq = {
      method: 'GET',
      headers: { authorization: 'Bearer supersecret' },
      query: {},
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const calledDate = mockAggregateDailyMetrics.mock.calls[0][0] as string;
    expect(calledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns 500 and calls notifier when aggregation throws', async () => {
    mockAggregateDailyMetrics.mockRejectedValue(new Error('Redis down'));

    const req: MockReq = {
      method: 'GET',
      headers: { authorization: 'Bearer supersecret' },
      query: { date: '2026-04-18' },
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(500);
    expect((res.body as Record<string, string>).error).toBe('Report aggregation failed');
    expect(mockSendOpsNotification).toHaveBeenCalledOnce();
    const notifArg = mockSendOpsNotification.mock.calls[0][0];
    expect(notifArg.level).toBe('WARN');
    expect(notifArg.subject).toBe('Daily report aggregation failed');
  });
});
