// ═══ Intent-Based Routing Types ═══════════════════════════════

/** High-level query intent */
export type QueryIntent = 'semantic_qa' | 'repo_analytics' | 'hybrid_analytics_qa';

/** Entity types that support aggregate queries */
export type AnalyticsEntity = 'pr' | 'issue' | 'commit';

/** State filter for PRs and issues */
export type EntityState = 'open' | 'closed' | 'merged' | 'all';

/** Aggregate operation */
export type AggregateOp = 'count' | 'top_authors';

/** Extracted date range */
export interface DateRange {
  since: string; // ISO 8601, e.g. "2024-01-01T00:00:00Z"
  until: string; // ISO 8601, e.g. "2024-06-30T23:59:59Z"
}

/** A fully parsed analytics query */
export interface AnalyticsQuery {
  op: AggregateOp;
  entity: AnalyticsEntity;
  dateRange: DateRange | null;
  state: EntityState;
  originalQuestion: string;
}

/** Result of intent classification */
export interface IntentClassification {
  intent: QueryIntent;
  analyticsQuery: AnalyticsQuery | null; // non-null when intent !== 'semantic_qa'
}

/** Result from executing an analytics query */
export interface AnalyticsResult {
  answer: string;
  data: {
    op: AggregateOp;
    entity: AnalyticsEntity;
    dateRange: DateRange | null;
    state: EntityState;
    count: number;
    truncated: boolean;
    topAuthors?: Array<{ author: string; count: number }>;
  };
}
