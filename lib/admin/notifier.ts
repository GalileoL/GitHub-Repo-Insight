export type NotificationLevel = 'INFO' | 'WARN' | 'CRITICAL';
export type NotificationScenario = 'daily_report' | 'live_alert';

export interface NotificationPayload {
  level: NotificationLevel;
  scenario: NotificationScenario;
  subject: string;
  body: string;
  repo?: string;
  alertType?: string;
}

async function tryWebhook(payload: NotificationPayload): Promise<boolean> {
  const url = process.env.OPS_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function tryResend(payload: NotificationPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.OPS_EMAIL_TO;
  const from = process.env.OPS_EMAIL_FROM;
  if (!apiKey || !to || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: payload.subject,
        text: payload.body,
      }),
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ channel: 'resend', status: res.status, body: await res.text().catch(() => '') }));
    }
    return res.ok;
  } catch {
    return false;
  }
}

function logStructured(payload: NotificationPayload): void {
  console.log(JSON.stringify({ ...payload, sentAt: new Date().toISOString() }));
}

export async function sendOpsNotification(payload: NotificationPayload): Promise<void> {
  try {
    // For live_alert: try webhook first
    if (payload.scenario === 'live_alert') {
      const webhookSent = await tryWebhook(payload);
      if (webhookSent) return;
    }

    // For daily_report, or if webhook failed: try Resend
    const resendSent = await tryResend(payload);
    if (resendSent) return;

    // Always-fallback: structured log
    logStructured(payload);
  } catch {
    // Final safety net — never throw
    logStructured(payload);
  }
}
