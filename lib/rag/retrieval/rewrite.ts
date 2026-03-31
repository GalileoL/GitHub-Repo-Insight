import type {
  QueryCategory,
  QueryAnchors,
  AnchorDiscount,
  QueryRiskSignals,
  QueryAnalysis,
  ScoreSource,
  RetrievalConfidence,
  RewriteThresholds,
  RewriteDecision,
  RewriteCandidate,
  RewriteResult,
  ReasonCode,
  ScoredChunk,
} from '../types.js';

// ─── Constants ────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: RewriteThresholds = {
  light: 0.3,
  strong: 0.55,
  llm: 0.8,
  confidenceFloor: 0.3,
  consensusBonus: 0.05,
};

const RISK_WEIGHTS = {
  isVague: 0.30,
  isComplex: 0.25,
  hasImplicitContext: 0.20,
  isComparative: 0.15,
  hasNegation: 0.10,
} as const;

const ANCHOR_MULTIPLIERS: Record<keyof QueryAnchors, number> = {
  filePaths: 0.5,
  endpoints: 0.6,
  codeSymbols: 0.7,
  directories: 0.7,
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'above', 'below', 'and', 'but', 'or',
  'if', 'then', 'so', 'than', 'too', 'very', 'just', 'that', 'this',
  'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'me',
]);

// ─── Anchor Extraction ───────────────────────────────────────

const FILE_PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.\w{1,5}/g;
const ENDPOINT_RE = /(?:(?:GET|POST|PUT|DELETE|PATCH)\s+\/[\w\/.-]+|\/api\/[\w\/.-]+)/gi;
const DIRECTORY_RE = /(?:[\w.-]+\/){2,}/g;
const BACKTICK_SYMBOL_RE = /`([A-Za-z_]\w+)`/g;
const PASCAL_CAMEL_RE = /\b([A-Z][a-z]+[A-Z]\w*|[a-z]+[A-Z]\w*)\b/g;

function extractAnchors(query: string): QueryAnchors {
  const filePaths = Array.from(new Set(query.match(FILE_PATH_RE) ?? []));

  const endpoints = Array.from(new Set(
    (query.match(ENDPOINT_RE) ?? []).map((e) => e.trim()),
  ));

  const directories = Array.from(new Set(
    (query.match(DIRECTORY_RE) ?? []).filter((d) => !filePaths.some((fp) => fp.includes(d))),
  ));

  // Code symbols: backtick-wrapped or PascalCase/camelCase, excluding file path fragments
  const filePathTokens = new Set(filePaths.flatMap((fp) => fp.split(/[\/\.]/)));
  const backtickMatches: string[] = [];
  let m: RegExpExecArray | null;
  const btRe = new RegExp(BACKTICK_SYMBOL_RE.source, BACKTICK_SYMBOL_RE.flags);
  while ((m = btRe.exec(query)) !== null) {
    backtickMatches.push(m[1]);
  }
  const camelMatches = (query.replace(/`[^`]*`/g, '').match(PASCAL_CAMEL_RE) ?? [])
    .filter((s) => !filePathTokens.has(s));
  const codeSymbols = Array.from(new Set([...backtickMatches, ...camelMatches]));

  return { filePaths, endpoints, codeSymbols, directories };
}

// ─── Risk Signal Detection ────────────────────────────────────

function detectRiskSignals(query: string, anchors: QueryAnchors): QueryRiskSignals {
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 0 && !STOPWORDS.has(w));
  const hasAnyAnchor = Object.values(anchors).some((arr) => arr.length > 0);

  const isVague =
    (words.length <= 3 && !hasAnyAnchor) ||
    /^(tell me about|explain|show me|describe)\b/.test(q);

  const isComplex =
    (words.length > 15) ||
    (q.includes(' and ') && q.includes('?') && /\b(how|what|why|where)\b/.test(q)) ||
    /\b(but also|as well as)\b/.test(q) ||
    (q.match(/\?/g) ?? []).length > 1 ||
    /\b(architecture|design|interact|relationship between)\b/.test(q);

  const hasNegation = /\b(not|without|except|don't|doesn't|isn't|aren't|no\s)\b/.test(q);

  const isComparative = /\b(vs|versus|compare|comparing|difference|differ|between .+ and)\b/.test(q);

  const hasImplicitContext =
    /^(it|they|that|this|these|those)\b/.test(q) ||
    /\b(does|do|did|will|would|can|could|should)\s+(it|they|that|this)\b/.test(q) ||
    /\b(the above|mentioned|previous)\b/.test(q);

  return { isVague, isComplex, hasNegation, isComparative, hasImplicitContext };
}

// ─── Risk Scoring ─────────────────────────────────────────────

function computeRiskScore(
  signals: QueryRiskSignals,
  anchors: QueryAnchors,
): { riskScore: number; anchorDiscount: AnchorDiscount | null } {
  const rawScore =
    (signals.isVague ? RISK_WEIGHTS.isVague : 0) +
    (signals.isComplex ? RISK_WEIGHTS.isComplex : 0) +
    (signals.hasImplicitContext ? RISK_WEIGHTS.hasImplicitContext : 0) +
    (signals.isComparative ? RISK_WEIGHTS.isComparative : 0) +
    (signals.hasNegation ? RISK_WEIGHTS.hasNegation : 0);

  // Find the lowest applicable anchor multiplier
  let bestMultiplier = 1.0;
  let bestAnchorType: keyof QueryAnchors | null = null;
  for (const [type, multiplier] of Object.entries(ANCHOR_MULTIPLIERS) as [keyof QueryAnchors, number][]) {
    if (anchors[type].length > 0 && multiplier < bestMultiplier) {
      bestMultiplier = multiplier;
      bestAnchorType = type;
    }
  }

  const discountedScore = Math.min(1, Math.max(0, rawScore * bestMultiplier));
  const anchorDiscount: AnchorDiscount | null = bestAnchorType
    ? {
        appliedMultiplier: bestMultiplier,
        anchorType: bestAnchorType,
        rawRiskScore: rawScore,
        discountedRiskScore: discountedScore,
      }
    : null;

  return { riskScore: discountedScore, anchorDiscount };
}

// ─── Public: analyzeQuery ─────────────────────────────────────

export function analyzeQuery(query: string, category: QueryCategory): QueryAnalysis {
  const anchors = extractAnchors(query);
  const riskSignals = detectRiskSignals(query, anchors);
  const { riskScore, anchorDiscount } = computeRiskScore(riskSignals, anchors);

  return {
    original: query,
    anchors,
    riskSignals,
    riskScore,
    anchorDiscount,
    category,
  };
}

// ─── Confidence Scoring ───────────────────────────────────────

const CONFIDENCE_WEIGHTS = {
  topScore: 0.35,
  scoreGap: 0.25,
  coverageRatio: 0.25,
  avgScore: 0.15,
} as const;

/**
 * Compute retrieval confidence from first-pass results.
 * Score-source agnostic — works with any scoring stage.
 * Returns all zeros for empty results.
 */
export function computeConfidence(
  results: ScoredChunk[],
  scoreSource: ScoreSource,
): RetrievalConfidence {
  if (results.length === 0) {
    return { topScore: 0, scoreGap: 0, coverageRatio: 0, avgScore: 0, confidenceScore: 0, scoreSource };
  }

  const scores = results.map((r) => r.score).sort((a, b) => b - a);
  const topScore = scores[0];
  const scoreGap = scores.length > 1 ? scores[0] - scores[1] : 0;

  // Coverage: fraction of results above a relevance floor
  // Use an absolute floor of 0.3 to avoid inflating coverage when all scores are low
  const COVERAGE_FLOOR = 0.3;
  const coverageRatio = scores.filter((s) => s > COVERAGE_FLOOR).length / scores.length;

  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  // Normalize each component to 0–1 within the result set
  const maxPossibleGap = topScore; // gap can't exceed top score
  const normalizedGap = maxPossibleGap > 0 ? Math.min(1, scoreGap / maxPossibleGap) : 0;

  const confidenceScore = Math.min(1, Math.max(0,
    topScore * CONFIDENCE_WEIGHTS.topScore +
    normalizedGap * CONFIDENCE_WEIGHTS.scoreGap +
    coverageRatio * CONFIDENCE_WEIGHTS.coverageRatio +
    avgScore * CONFIDENCE_WEIGHTS.avgScore,
  ));

  return { topScore, scoreGap, coverageRatio, avgScore, confidenceScore, scoreSource };
}

// ─── Rewrite Decision ─────────────────────────────────────────

/**
 * Deterministic decision engine: maps risk + confidence to a rewrite mode.
 * Returns structured reason codes for logging and analysis.
 */
export function makeRewriteDecision(
  analysis: QueryAnalysis,
  confidence: RetrievalConfidence,
  thresholds?: Partial<RewriteThresholds>,
): RewriteDecision {
  const t: RewriteThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const rewriteScore = Math.min(1, Math.max(0,
    (analysis.riskScore * 0.6) + ((1 - confidence.confidenceScore) * 0.4),
  ));

  const reasonCodes: ReasonCode[] = [];

  // Collect risk reason codes
  if (analysis.riskSignals.isVague) reasonCodes.push('vague_query');
  if (analysis.riskSignals.isComplex) reasonCodes.push('complex_query');
  if (analysis.riskSignals.hasNegation) reasonCodes.push('negation_present');
  if (analysis.riskSignals.isComparative) reasonCodes.push('comparative_query');
  if (analysis.riskSignals.hasImplicitContext) reasonCodes.push('implicit_context');

  // Collect confidence reason codes
  if (confidence.topScore < 0.3) reasonCodes.push('low_top_score');
  if (confidence.scoreGap < 0.1) reasonCodes.push('small_score_gap');
  if (confidence.coverageRatio < 0.5) reasonCodes.push('low_coverage');
  if (confidence.avgScore < 0.2) reasonCodes.push('low_avg_score');

  // Determine mode from thresholds
  let mode: RewriteDecision['mode'];
  if (rewriteScore >= t.llm) {
    // strong-llm guard: ALL three conditions required
    const hasAnyAnchor = Object.values(analysis.anchors).some((arr) => arr.length > 0);
    if (!hasAnyAnchor && confidence.confidenceScore < t.confidenceFloor) {
      mode = 'strong-llm';
    } else {
      mode = 'strong';
      if (hasAnyAnchor) reasonCodes.push('anchors_present');
    }
  } else if (rewriteScore >= t.strong) {
    mode = 'strong';
  } else if (rewriteScore >= t.light) {
    mode = 'light';
  } else {
    mode = 'none';
    if (confidence.confidenceScore > 0.5) reasonCodes.push('high_confidence');
  }

  const reason = reasonCodes.length > 0
    ? `${mode}: ${reasonCodes.join(', ')} (score=${rewriteScore.toFixed(2)})`
    : `${mode}: no significant risk signals (score=${rewriteScore.toFixed(2)})`;

  return { mode, reasonCodes, reason, rewriteScore, thresholds: t };
}
