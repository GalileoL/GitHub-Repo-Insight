/** Source type for a RAG chunk */
export type ChunkType = 'readme' | 'issue' | 'pr' | 'release' | 'commit' | 'code_summary';

/** Query intent classification */
export type QueryCategory = 'documentation' | 'community' | 'changes' | 'code' | 'general';

/** Metadata attached to each chunk stored in the vector DB */
export interface ChunkMetadata {
  repo: string;
  type: ChunkType;
  title: string;
  githubUrl: string;
  filePath?: string;
  issueNumber?: number;
  prNumber?: number;
  commitSha?: string;
  releaseName?: string;
  createdAt?: string;
  tags?: string[];
  symbolNames?: string[];
  symbolsTruncated?: boolean;
  language?: string;
  summaryTruncated?: boolean;
  lastIndexedSha?: string;
}

/** A document chunk ready for embedding */
export interface Chunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
}

/** A retrieved chunk with relevance score */
export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

/** A source citation returned to the user */
export interface Source {
  type: ChunkType;
  title: string;
  url: string;
  issueNumber?: number;
  prNumber?: number;
  releaseName?: string;
  snippet?: string;
}

/** Response from the /api/rag/ask endpoint */
export interface AskResponse {
  answer: string;
  sources: Source[];
  requestId?: string;
}

/** Response from the /api/rag/ingest endpoint */
export interface IngestResponse {
  status: 'ok' | 'error';
  chunksIndexed: number;
  message?: string;
  codeSummaryCount?: number;
  codeSummaryFailed?: boolean;
  codeSummaryFailureReason?: string;
}

/** Response from the /api/rag/status endpoint */
export interface StatusResponse {
  indexed: boolean;
  chunkCount: number;
  lastSync?: string;
}

/** A source file fetched from a repository for code summary indexing */
export interface RawSourceFile {
  path: string;
  content: string;
  size: number;
}

/** Raw GitHub data fetched for ingestion */
export interface RawRepoData {
  readme: string | null;
  issues: RawIssue[];
  pulls: RawPull[];
  releases: RawRelease[];
  commits: RawCommit[];
  sourceFiles?: RawSourceFile[];
  headSha?: string;
}

export interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  user: string | null;
  labels: Array<{ name: string }>;
}

export interface RawPull {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  html_url: string;
  created_at: string;
  user: string | null;
  labels: Array<{ name: string }>;
  changedFiles?: string[];
}

export interface RawRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
}

export interface RawCommit {
  sha: string;
  message: string;
  html_url: string;
  date: string;
  author: string | null;
}

// ═══ Query Rewrite Types ══════════════════════════════════════

/** Anchors extracted from the query that must be preserved verbatim */
export interface QueryAnchors {
  filePaths: string[];
  endpoints: string[];
  codeSymbols: string[];
  directories: string[];
}

/** Which anchor type caused the risk discount, and by how much */
export interface AnchorDiscount {
  appliedMultiplier: number;
  anchorType: keyof QueryAnchors;
  rawRiskScore: number;
  discountedRiskScore: number;
}

/** Risk signals that indicate the query may need rewriting */
export interface QueryRiskSignals {
  isVague: boolean;
  isComplex: boolean;
  hasNegation: boolean;
  isComparative: boolean;
  hasImplicitContext: boolean;
}

/** Full analysis result for a query */
export interface QueryAnalysis {
  original: string;
  anchors: QueryAnchors;
  riskSignals: QueryRiskSignals;
  riskScore: number;
  anchorDiscount: AnchorDiscount | null;
  category: QueryCategory;
}

// 'hybrid_rrf':     raw RRF fusion scores (before rerank) — not currently exposed
// 'rerank_boosted': scores after hybridSearch's internal rerank — current default
// 'normalized':     reserved for future use
export type ScoreSource = 'hybrid_rrf' | 'rerank_boosted' | 'normalized';

/** Signals computed from first-pass retrieval results */
export interface RetrievalConfidence {
  topScore: number;
  scoreGap: number;
  coverageRatio: number;
  avgScore: number;
  confidenceScore: number;
  scoreSource: ScoreSource;
}

export type RewriteMode = 'none' | 'light' | 'strong' | 'strong-llm';

export type ReasonCode =
  | 'vague_query' | 'complex_query' | 'negation_present'
  | 'comparative_query' | 'implicit_context'
  | 'low_top_score' | 'small_score_gap' | 'low_coverage' | 'low_avg_score'
  | 'anchors_present' | 'high_confidence';

export interface RewriteThresholds {
  light: number;
  strong: number;
  llm: number;
  confidenceFloor: number;
  consensusBonus: number;
}

export interface RewriteDecision {
  mode: RewriteMode;
  reasonCodes: ReasonCode[];
  reason: string;
  rewriteScore: number;
  thresholds: RewriteThresholds;
}

export type RewriteStrategy = 'synonym' | 'decompose' | 'expand' | 'llm';

export interface RewriteCandidate {
  query: string;
  strategy: RewriteStrategy;
  preservedAnchors: QueryAnchors;
}

export interface RewriteResult {
  decision: RewriteDecision;
  candidates: RewriteCandidate[];
  analysis: QueryAnalysis;
}

export interface MergedChunk {
  chunk: Chunk;
  originalScore: number | null;
  rewriteScores: Record<number, number>;
  mergedScore: number;
  sourceQueries: string[];
  fromOriginal: boolean;
}

export interface RetrievalSnapshot {
  topScore: number;
  avgScore: number;
  chunkIds: string[];
  coverageRatio: number;
}

export interface RetrievalComparison extends RetrievalSnapshot {
  newChunkIds: string[];
  droppedChunkIds: string[];
  overlapRatio: number;
}

export interface RetrievalDiagnostics {
  requestId: string;
  originalQuery: string;
  repo: string;
  analysis: QueryAnalysis;
  firstPassConfidence: RetrievalConfidence;
  decision: RewriteDecision;
  candidates: RewriteCandidate[];
  beforeRewrite: RetrievalSnapshot;
  afterRewrite: RetrievalComparison | null;
  timing: {
    totalRetrievalMs: number;
    firstPassMs: number;
    rewriteDecisionMs: number;
    rewriteSearchMs: number;
    llmRewriteMs: number | null;
    mergeMs: number;
    rerankMs: number;
  };
  counts: {
    firstPassChunks: number;
    mergedChunks: number;
    deduplicatedChunks: number;
    finalChunks: number;
  };
}

// ═══ Code Summary Extraction Types ══════════════════════════════

/** Structured facts extracted from a source file via AST or regex */
export interface ExtractedCodeFacts {
  filePath: string;
  language: string;
  roleHint: string | null;
  exports: string[];
  symbolSignatures: string[];
  internalHelpers: string[];
  importPaths: string[];
  kindHints: string[];
  jsDocSummary: string | null;
}

// ═══ Evaluation Event Types ════════════════════════════════════

/** Base fields shared across all evaluation events */
export interface EvalEventBase {
  requestId: string;
  repo: string;
  timestamp: number;
  login: string;
}

/** Retrieval quality metrics */
export interface RetrievalEvalEvent extends EvalEventBase {
  type: 'retrieval_eval';
  queryCategory: QueryCategory;
  queryIntent: string;
  rewriteMode: RewriteMode;
  typeFilter: ChunkType[] | null;
  firstPassCount: number;
  finalCount: number;
  topScore: number;
  avgScore: number;
  coverageRatio: number;
  typeCoverage: ChunkType[];
  totalRetrievalMs: number;
}

/** Code fetch metrics (only when code retrieval triggered) */
export interface CodeFetchEvalEvent extends EvalEventBase {
  type: 'code_fetch_eval';
  triggerReason: 'category_code' | 'code_summary_hit' | 'manual';
  candidateFiles: string[];
  selectedFiles: string[];
  fetchedFiles: string[];
  failedFiles: Array<{ path: string; reason: string }>;
  fetchLatencyMs: number;
  fetchSuccessRate: number;
  bytesInjected: number;
  truncated: boolean;
  matchedBy: 'filepath' | 'symbol' | 'rank' | 'mixed';
  usedSummaryOnlyFallback: boolean;
}

/** Answer quality proxy metrics */
export interface AnswerEvalEvent extends EvalEventBase {
  type: 'answer_eval';
  answerLength: number;
  sourceCount: number;
  hasCodeContext: boolean;
  answerUsedRetrievedCode: boolean;
  containsFilePathMention: boolean;
  containsSymbolMention: boolean;
  streamCancelled: boolean;
  totalDurationMs: number;
  fallbackTriggered: boolean;
  fallbackReason: 'none' | 'no_match' | 'fetch_failed' | 'context_trimmed';
}
