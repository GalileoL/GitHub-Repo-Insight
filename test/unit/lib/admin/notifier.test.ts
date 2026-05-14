import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendOpsNotification } from '../../../../lib/admin/notifier.js';

describe('sendOpsNotification', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.OPS_WEBHOOK_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.OPS_EMAIL_TO;
    delete process.env.OPS_EMAIL_FROM;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('falls through to structured log without throwing when no env vars set', async () => {
    const logSpy = vi.spyOn(console, 'log');

    await expect(
      sendOpsNotification({
        level: 'INFO',
        scenario: 'daily_report',
        subject: 'Test subject',
        body: 'Test body',
      }),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.subject).toBe('Test subject');
    expect(logged.sentAt).toBeDefined();
  });

  it('calls webhook when OPS_WEBHOOK_URL is set and fetch succeeds', async () => {
    process.env.OPS_WEBHOOK_URL = 'https://hooks.example.com/notify';

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    await sendOpsNotification({
      level: 'WARN',
      scenario: 'live_alert',
      subject: 'Alert',
      body: 'Something happened',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toBe('https://hooks.example.com/notify');
  });

  it('does not propagate when webhook fetch throws', async () => {
    process.env.OPS_WEBHOOK_URL = 'https://hooks.example.com/notify';

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const logSpy = vi.spyOn(console, 'log');

    await expect(
      sendOpsNotification({
        level: 'WARN',
        scenario: 'live_alert',
        subject: 'Alert',
        body: 'Something happened',
      }),
    ).resolves.toBeUndefined();

    // Falls through to structured log
    expect(logSpy).toHaveBeenCalled();
  });

  it('falls through to log without throwing when Resend returns 403', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.OPS_EMAIL_TO = 'ops@example.com';
    process.env.OPS_EMAIL_FROM = 'noreply@example.com';

    const warnSpy = vi.spyOn(console, 'warn');
    const logSpy = vi.spyOn(console, 'log');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      sendOpsNotification({
        level: 'WARN',
        scenario: 'daily_report',
        subject: 'Report',
        body: 'Body text',
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    const warned = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(warned.channel).toBe('resend');
    expect(warned.status).toBe(403);

    // Falls through to structured log
    expect(logSpy).toHaveBeenCalled();
  });

  it('skips Resend entirely when OPS_EMAIL_FROM is missing', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.OPS_EMAIL_TO = 'ops@example.com';
    // OPS_EMAIL_FROM intentionally absent

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const logSpy = vi.spyOn(console, 'log');

    await sendOpsNotification({
      level: 'INFO',
      scenario: 'daily_report',
      subject: 'Test',
      body: 'Body',
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
