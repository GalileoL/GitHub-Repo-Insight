import type { DailyMetrics } from './metrics-aggregator.js';

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function renderDailyReport(metrics: DailyMetrics): string {
  const lines: string[] = [];

  lines.push(`# Daily RAG Report — ${metrics.date}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Total requests: ${metrics.totalRequests}`);
  lines.push(`- Code fetch trigger rate: ${pct(metrics.codeFetchTriggerRate)}`);
  lines.push(`- Fetch success rate: ${pct(metrics.fetchSuccessRate)}`);
  lines.push(`- Summary-only fallback rate: ${pct(metrics.summaryOnlyFallbackRate)}`);
  lines.push(`- Answer used retrieved code: ${pct(metrics.answerUsedRetrievedCodeRatio)}`);
  lines.push('');

  lines.push('## Category Distribution');
  const totalRequests = metrics.totalRequests;
  const catEntries = Object.entries(metrics.categoryDistribution).sort(
    (a, b) => b[1] - a[1],
  );
  if (catEntries.length === 0) {
    lines.push('(no data)');
  } else {
    for (const [cat, count] of catEntries) {
      const share = totalRequests > 0 ? pct(count / totalRequests) : '0.0%';
      lines.push(`- ${cat}: ${count} (${share})`);
    }
  }
  lines.push('');

  lines.push('## Top Files Fetched');
  if (metrics.topSelectedFiles.length === 0) {
    lines.push('(no data)');
  } else {
    metrics.topSelectedFiles.forEach(({ path, count }, i) => {
      lines.push(`${i + 1}. ${path} (${count}x)`);
    });
  }
  lines.push('');

  lines.push('## Failure Reasons');
  const failEntries = Object.entries(metrics.failureReasonDistribution).sort(
    (a, b) => b[1] - a[1],
  );
  if (failEntries.length === 0) {
    lines.push('(no failures)');
  } else {
    for (const [reason, count] of failEntries) {
      lines.push(`- ${reason}: ${count}`);
    }
  }

  return lines.join('\n');
}
