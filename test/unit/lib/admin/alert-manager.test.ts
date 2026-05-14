import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSendOpsNotification, mockRedis } = vi.hoisted(() => ({
  mockSendOpsNotification: vi.fn().mockResolvedValue(undefined),
  mockRedis: {
    incr: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    exists: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../../../lib/admin/notifier.js', () => ({
  sendOpsNotification: mockSendOpsNotification,
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(class MockRedis {
    constructor() {
      return mockRedis;
    }
  }),
}));

import {
  incrementAlertStreak,
  resetAlertStreak,
  checkAndFireStreakAlert,
  checkThresholdAlert,
  _resetRedis,
} from '../../../../lib/admin/alert-manager.js';

describe('alert-manager', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    _resetRedis();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('incrementAlertStreak', () => {
    it('calls INCR then EXPIRE and returns new count', async () => {
      mockRedis.incr.mockResolvedValueOnce(3);
      mockRedis.expire.mockResolvedValueOnce(1);

      const count = await incrementAlertStreak('timeout_streak', 'owner/repo');

      expect(count).toBe(3);
      expect(mockRedis.incr).toHaveBeenCalledWith('rag:alert:streak:timeout_streak:owner/repo');
      expect(mockRedis.expire).toHaveBeenCalledWith('rag:alert:streak:timeout_streak:owner/repo', 24 * 3600);
    });

    it('returns 0 when Redis throws', async () => {
      mockRedis.incr.mockRejectedValueOnce(new Error('Network error'));

      const count = await incrementAlertStreak('timeout_streak', 'owner/repo');

      expect(count).toBe(0);
    });
  });

  describe('resetAlertStreak', () => {
    it('calls DEL and resolves', async () => {
      mockRedis.del.mockResolvedValueOnce(1);

      await expect(resetAlertStreak('timeout_streak', 'owner/repo')).resolves.toBeUndefined();
      expect(mockRedis.del).toHaveBeenCalledWith('rag:alert:streak:timeout_streak:owner/repo');
    });

    it('does not throw when Redis throws', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('Network error'));

      await expect(resetAlertStreak('timeout_streak', 'owner/repo')).resolves.toBeUndefined();
    });
  });

  describe('checkAndFireStreakAlert', () => {
    it('fires notification when streak >= threshold and no suppress key', async () => {
      mockRedis.get.mockResolvedValueOnce(5);
      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.set.mockResolvedValueOnce('OK');

      await checkAndFireStreakAlert('timeout_streak', 'owner/repo', 5, { repo: 'owner/repo' });

      expect(mockSendOpsNotification).toHaveBeenCalledOnce();
      expect(mockSendOpsNotification.mock.calls[0][0]).toMatchObject({
        level: 'WARN',
        scenario: 'live_alert',
        repo: 'owner/repo',
        alertType: 'timeout_streak',
      });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'rag:alert:suppress:timeout_streak:owner/repo',
        '1',
        { ex: 3600 },
      );
    });

    it('does NOT fire when suppress key exists', async () => {
      mockRedis.get.mockResolvedValueOnce(10);
      mockRedis.exists.mockResolvedValueOnce(1);

      await checkAndFireStreakAlert('timeout_streak', 'owner/repo', 5, { repo: 'owner/repo' });

      expect(mockSendOpsNotification).not.toHaveBeenCalled();
    });

    it('does NOT fire when streak < threshold', async () => {
      mockRedis.get.mockResolvedValueOnce(2);
      mockRedis.exists.mockResolvedValueOnce(0);

      await checkAndFireStreakAlert('timeout_streak', 'owner/repo', 5, { repo: 'owner/repo' });

      expect(mockSendOpsNotification).not.toHaveBeenCalled();
    });

    it('never throws when Redis throws', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        checkAndFireStreakAlert('timeout_streak', 'owner/repo', 5, { repo: 'owner/repo' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkThresholdAlert', () => {
    it('fires notification when value <= threshold and no suppress key', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.set.mockResolvedValueOnce('OK');

      await checkThresholdAlert('github_rate_limit_low', 'owner/repo', 50, 100, { value: 50, threshold: 100 });

      expect(mockSendOpsNotification).toHaveBeenCalledOnce();
      expect(mockSendOpsNotification.mock.calls[0][0]).toMatchObject({
        level: 'WARN',
        scenario: 'live_alert',
        repo: 'owner/repo',
        alertType: 'github_rate_limit_low',
      });
    });

    it('does NOT fire when value > threshold', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);

      await checkThresholdAlert('github_rate_limit_low', 'owner/repo', 200, 100, { value: 200, threshold: 100 });

      expect(mockSendOpsNotification).not.toHaveBeenCalled();
    });

    it('never throws when Redis throws', async () => {
      mockRedis.exists.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        checkThresholdAlert('github_rate_limit_low', 'owner/repo', 50, 100, {}),
      ).resolves.toBeUndefined();
    });
  });
});
