import { parseAnalyticsQuery } from './parse-analytics.js';
import type { IntentClassification } from './types.js';

/**
 * Rule-based intent classifier.
 *
 * Detection order:
 * 1. Check for aggregate/count intent signals (both EN and CN)
 * 2. If aggregate intent + entity found → repo_analytics
 * 3. If aggregate intent + entity + semantic explanation cues → hybrid_analytics_qa
 * 4. Otherwise → semantic_qa (falls through to existing RAG pipeline)
 */
export function classifyIntent(question: string): IntentClassification {
  const q = question.toLowerCase();

  // ── Gate: does the question express a counting / stats intent? ──
  const countSignals = [
    // English
    'how many', 'count', 'total', 'number of',
    // Chinese
    '多少', '统计', '数量', '几个', '有多少', '总共', '一共',
  ];
  const hasCountIntent = countSignals.some((s) => q.includes(s));

  // top-N / ranking intent
  const rankSignals = ['top ', 'most active', 'most prolific', '最多', '排名', '贡献最多', '谁的'];
  const hasRankIntent = rankSignals.some((s) => q.includes(s));

  if (!hasCountIntent && !hasRankIntent) {
    return { intent: 'semantic_qa', analyticsQuery: null };
  }

  // ── Try to parse a structured analytics query ──
  const analyticsQuery = parseAnalyticsQuery(question);
  if (!analyticsQuery) {
    return { intent: 'semantic_qa', analyticsQuery: null };
  }

  // ── Check for hybrid signals: needs explanation + exact facts ──
  const hybridSignals = [
    'why', 'explain', 'theme', 'trend', 'pattern', 'summary', 'summarize',
    'what are', 'what were', 'describe',
    '为什么', '解释', '趋势', '总结', '描述', '主要是', '有哪些',
  ];
  const hasHybridSignal = hybridSignals.some((s) => q.includes(s));

  if (hasHybridSignal) {
    return { intent: 'hybrid_analytics_qa', analyticsQuery };
  }

  return { intent: 'repo_analytics', analyticsQuery };
}
