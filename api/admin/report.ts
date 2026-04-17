import type { VercelRequest, VercelResponse } from '@vercel/node';
import { aggregateDailyMetrics } from '../../lib/admin/metrics-aggregator.js';
import { renderDailyReport } from '../../lib/admin/report-renderer.js';
import { sendOpsNotification } from '../../lib/admin/notifier.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: Bearer CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dateParam =
    typeof req.query['date'] === 'string' ? req.query['date'] : null;
  const dateUtc = dateParam ?? new Date().toISOString().slice(0, 10);

  const metrics = await aggregateDailyMetrics(dateUtc);
  const report = renderDailyReport(metrics);

  await sendOpsNotification({
    level: 'INFO',
    scenario: 'daily_report',
    subject: `Daily RAG Report — ${dateUtc}`,
    body: report,
  });

  return res.status(200).json({ ok: true, metrics });
}
