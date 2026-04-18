import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { aggregateDailyMetrics } from '../../lib/admin/metrics-aggregator.js';
import { renderDailyReport } from '../../lib/admin/report-renderer.js';
import { sendOpsNotification } from '../../lib/admin/notifier.js';

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function previousUtcDateString(now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: Bearer CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }

  const authHeader = typeof req.headers['authorization'] === 'string'
    ? req.headers['authorization']
    : '';
  if (!safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dateParam =
    typeof req.query['date'] === 'string' ? req.query['date'] : null;
  const dateUtc = dateParam ?? previousUtcDateString(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateUtc)) {
    return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
  }

  try {
    const metrics = await aggregateDailyMetrics(dateUtc);
    const report = renderDailyReport(metrics);

    await sendOpsNotification({
      level: 'INFO',
      scenario: 'daily_report',
      subject: `Daily RAG Report — ${dateUtc}`,
      body: report,
    });

    return res.status(200).json({ ok: true, metrics });
  } catch (err) {
    await sendOpsNotification({
      level: 'WARN',
      scenario: 'daily_report',
      subject: 'Daily report aggregation failed',
      body: String(err),
    });
    return res.status(500).json({ error: 'Report aggregation failed' });
  }
}
