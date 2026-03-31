import type { AnalyticsQuery, AnalyticsEntity, EntityState, DateRange, AggregateOp } from './types.js';

// ═══ Entity Extraction ═══════════════════════════════════════

const ENTITY_PATTERNS: Array<{ re: RegExp; entity: AnalyticsEntity }> = [
  { re: /\b(?:prs?|pull\s*requests?)\b|合并请求|拉取请求/i, entity: 'pr' },
  { re: /\b(?:issues?|bugs?)\b|问题|工单/i, entity: 'issue' },
  { re: /\b(?:commits?)\b|提交/i, entity: 'commit' },
];

function extractEntity(q: string): AnalyticsEntity | null {
  for (const { re, entity } of ENTITY_PATTERNS) {
    if (re.test(q)) return entity;
  }
  return null;
}

// ═══ State Extraction ════════════════════════════════════════

function extractState(q: string, entity: AnalyticsEntity): EntityState {
  const lower = q.toLowerCase();
  if (/\bmerged?\b/i.test(q) || /合并/.test(q)) {
    return entity === 'pr' ? 'merged' : 'closed';
  }
  if (lower.includes('closed') || q.includes('已关闭')) return 'closed';
  if (/\bopen\b/i.test(q) || q.includes('未关闭') || q.includes('打开')) return 'open';
  return 'all';
}

// ═══ Operation Extraction ════════════════════════════════════

function extractOp(q: string): AggregateOp {
  const lower = q.toLowerCase();
  const rankSignals = ['top ', 'most active', 'most prolific', '最多', '排名', '贡献最多', '谁的'];
  if (rankSignals.some((s) => lower.includes(s))) return 'top_authors';
  return 'count';
}

// ═══ Date Range Extraction ═══════════════════════════════════

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthToRange(year: number, sinceMonth: number, untilMonth: number): DateRange {
  const lastDay = lastDayOfMonth(year, untilMonth);
  return {
    since: `${year}-${String(sinceMonth).padStart(2, '0')}-01T00:00:00Z`,
    until: `${year}-${String(untilMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59Z`,
  };
}

function extractDateRange(q: string): DateRange | null {
  const now = new Date();
  const currentYear = now.getFullYear();

  // ── Chinese: X月到Y月 / X月至Y月 (with optional year) ──
  const cnMonthRange = q.match(/(?:(\d{4})年)?(\d{1,2})月\s*(?:到|至|[-–—])\s*(\d{1,2})月/);
  if (cnMonthRange) {
    const year = cnMonthRange[1] ? parseInt(cnMonthRange[1]) : currentYear;
    return monthToRange(year, parseInt(cnMonthRange[2]), parseInt(cnMonthRange[3]));
  }

  // ── Chinese: single month ──
  const cnYearMonth = q.match(/(\d{4})年(\d{1,2})月/);
  if (cnYearMonth) {
    const year = parseInt(cnYearMonth[1]);
    const month = parseInt(cnYearMonth[2]);
    return monthToRange(year, month, month);
  }

  // ── Chinese: year only ──
  const cnYear = q.match(/(\d{4})年/);
  if (cnYear) {
    const year = parseInt(cnYear[1]);
    return monthToRange(year, 1, 12);
  }

  // ── English: "between January and March 2024" / "from Jan to Mar" ──
  const enMonthRange = q.match(
    /(?:between|from)\s+(\w+)\s+(?:and|to)\s+(\w+)(?:\s+(\d{4}))?/i,
  );
  if (enMonthRange) {
    const m1 = MONTH_MAP[enMonthRange[1].toLowerCase()];
    const m2 = MONTH_MAP[enMonthRange[2].toLowerCase()];
    if (m1 && m2) {
      const year = enMonthRange[3] ? parseInt(enMonthRange[3]) : currentYear;
      return monthToRange(year, m1, m2);
    }
  }

  // ── Quarter: Q1–Q4 with optional year ──
  const quarterMatch = q.match(/\bQ([1-4])(?:\s+(\d{4}))?\b/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1]);
    const year = quarterMatch[2] ? parseInt(quarterMatch[2]) : currentYear;
    const sinceMonth = (quarter - 1) * 3 + 1;
    const untilMonth = quarter * 3;
    return monthToRange(year, sinceMonth, untilMonth);
  }

  // ── Explicit year: "in 2024" ──
  const yearOnly = q.match(/\bin\s+(\d{4})\b/i);
  if (yearOnly) {
    return monthToRange(parseInt(yearOnly[1]), 1, 12);
  }

  // ── English: "in January 2024" / "in March" ──
  const enSingleMonth = q.match(/\bin\s+(\w+)(?:\s+(\d{4}))?\b/i);
  if (enSingleMonth) {
    const m = MONTH_MAP[enSingleMonth[1].toLowerCase()];
    if (m) {
      const year = enSingleMonth[2] ? parseInt(enSingleMonth[2]) : currentYear;
      return monthToRange(year, m, m);
    }
  }

  // ── Relative: "last N months" / "过去N个月" / "最近N个月" ──
  const relativeMonths = q.match(/(?:last|past|过去|最近)\s*(\d+)\s*(?:months?|个月)/i);
  if (relativeMonths) {
    const n = parseInt(relativeMonths[1]);
    const until = new Date(now);
    const since = new Date(now);
    since.setMonth(since.getMonth() - n);
    return {
      since: since.toISOString().replace(/\.\d+Z$/, 'Z'),
      until: until.toISOString().replace(/\.\d+Z$/, 'Z'),
    };
  }

  return null;
}

// ═══ Main Parser ═════════════════════════════════════════════

/**
 * Parse a natural-language question into a structured AnalyticsQuery.
 * Returns null if the question cannot be parsed as an analytics query
 * (e.g. no recognizable entity).
 */
export function parseAnalyticsQuery(question: string): AnalyticsQuery | null {
  const entity = extractEntity(question);
  if (!entity) return null;

  const op = extractOp(question);
  const state = extractState(question, entity);
  const dateRange = extractDateRange(question);

  return {
    op,
    entity,
    dateRange,
    state,
    originalQuestion: question,
  };
}
