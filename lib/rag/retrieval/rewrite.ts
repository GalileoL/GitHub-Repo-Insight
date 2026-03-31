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

// ─── Synonym / Vocabulary Maps ────────────────────────────────

const SYNONYM_MAP: Record<string, string> = {
  auth: 'authentication',
  authn: 'authentication',
  authz: 'authorization',
  deps: 'dependencies',
  dep: 'dependency',
  config: 'configuration',
  env: 'environment',
  repo: 'repository',
  db: 'database',
  msg: 'message',
  err: 'error',
  req: 'request',
  res: 'response',
  fn: 'function',
  func: 'function',
  impl: 'implementation',
  init: 'initialization',
  param: 'parameter',
  params: 'parameters',
  arg: 'argument',
  args: 'arguments',
  dev: 'development',
  prod: 'production',
  perf: 'performance',
  docs: 'documentation',
  doc: 'documentation',
  info: 'information',
  async: 'asynchronous',
  sync: 'synchronous',
  middleware: 'middleware',
  ws: 'websocket',
  ci: 'continuous integration',
  cd: 'continuous deployment',
};

const CONCEPT_EXPANSIONS: Record<string, string> = {
  'error handling': 'error handling try catch error boundary exception',
  'rate limit': 'rate limit throttle quota requests per minute',
  'caching': 'caching cache invalidation ttl stale',
  'streaming': 'streaming SSE server-sent events stream chunk delta',
  'testing': 'testing test unit integration vitest mock',
  'deployment': 'deployment deploy vercel serverless production',
  'security': 'security authentication authorization token CORS XSS',
  'logging': 'logging log metrics monitoring observability',
  'search': 'search query retrieval vector keyword embedding',
};

// ─── Candidate Generation ─────────────────────────────────────

function allAnchorStrings(anchors: QueryAnchors): string[] {
  return [
    ...anchors.filePaths,
    ...anchors.endpoints,
    ...anchors.codeSymbols,
    ...anchors.directories,
  ];
}

function ensureAnchorsInQuery(query: string, anchors: QueryAnchors): string {
  const missing = allAnchorStrings(anchors).filter((a) => !query.includes(a));
  return missing.length > 0 ? `${query} ${missing.join(' ')}` : query;
}

function synonymRewrite(query: string, anchors: QueryAnchors): RewriteCandidate {
  let rewritten = query;
  for (const [short, full] of Object.entries(SYNONYM_MAP)) {
    const re = new RegExp(`\\b${short}\\b`, 'gi');
    rewritten = rewritten.replace(re, full);
  }
  // If nothing changed, add a small variation by lowercasing and trimming
  if (rewritten === query) {
    rewritten = query.toLowerCase().replace(/[?!.]+$/, '').trim();
    if (rewritten === query.toLowerCase()) {
      rewritten = `${query} overview`;
    }
  }
  rewritten = ensureAnchorsInQuery(rewritten, anchors);
  return { query: rewritten, strategy: 'synonym', preservedAnchors: anchors };
}

function decomposeRewrite(query: string, anchors: QueryAnchors): RewriteCandidate[] {
  // Split on conjunctions that join distinct topics
  const parts = query
    .split(/\b(?:and|but also|as well as|,\s*and|;\s*)\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 10);

  if (parts.length < 2) {
    // Can't decompose — return a concept expansion instead
    return [expandRewrite(query, anchors)];
  }

  return parts.slice(0, 2).map((part) => {
    const q = ensureAnchorsInQuery(part.replace(/[?!.]+$/, '').trim() + '?', anchors);
    return { query: q, strategy: 'decompose' as const, preservedAnchors: anchors };
  });
}

function expandRewrite(query: string, anchors: QueryAnchors): RewriteCandidate {
  const q = query.toLowerCase();
  let expanded = query;
  for (const [concept, expansion] of Object.entries(CONCEPT_EXPANSIONS)) {
    if (q.includes(concept)) {
      expanded = `${query} ${expansion}`;
      break;
    }
  }
  if (expanded === query) {
    // Generic expansion: add the category context
    expanded = `${query} implementation details`;
  }
  expanded = ensureAnchorsInQuery(expanded, anchors);
  return { query: expanded, strategy: 'expand', preservedAnchors: anchors };
}

/**
 * Generate rewrite candidates based on the decision mode.
 * Deterministic for none/light/strong. Async for strong-llm (LLM fallback).
 * If strong-llm's LLM call fails, falls back to strong's deterministic candidates.
 */
export async function generateCandidates(
  decision: RewriteDecision,
  analysis: QueryAnalysis,
): Promise<RewriteCandidate[]> {
  const { original, anchors } = analysis;

  switch (decision.mode) {
    case 'none':
      return [];

    case 'light':
      return [synonymRewrite(original, anchors)];

    case 'strong': {
      const synonym = synonymRewrite(original, anchors);
      const decomposed = decomposeRewrite(original, anchors);
      // Dedupe by query string
      const seen = new Set<string>();
      const candidates: RewriteCandidate[] = [];
      for (const c of [synonym, ...decomposed]) {
        if (!seen.has(c.query) && c.query !== original) {
          seen.add(c.query);
          candidates.push(c);
        }
      }
      return candidates.slice(0, 3);
    }

    case 'strong-llm': {
      // LLM rewrite — falls back to deterministic strong on failure.
      try {
        const { rewriteQueries } = await import('../llm/index.js');
        const llmQueries = await rewriteQueries(original, anchors, 3);
        if (llmQueries.length > 0) {
          return llmQueries.map((q) => ({
            query: ensureAnchorsInQuery(q, anchors),
            strategy: 'llm' as const,
            preservedAnchors: anchors,
          }));
        }
      } catch {
        // LLM failed — fall back to deterministic strong
      }
      // Fallback: same as strong mode
      const fallbackSynonym = synonymRewrite(original, anchors);
      const fallbackDecomposed = decomposeRewrite(original, anchors);
      const seen = new Set<string>();
      const fallbackCandidates: RewriteCandidate[] = [];
      for (const c of [fallbackSynonym, ...fallbackDecomposed]) {
        if (!seen.has(c.query) && c.query !== original) {
          seen.add(c.query);
          fallbackCandidates.push(c);
        }
      }
      return fallbackCandidates.slice(0, 3);
    }
  }
}

// ─── Public: analyzeAndRewrite (convenience) ──────────────────

export async function analyzeAndRewrite(
  query: string,
  category: QueryCategory,
  firstPassResults: ScoredChunk[],
  scoreSource: ScoreSource = 'rerank_boosted',
  thresholds?: Partial<RewriteThresholds>,
): Promise<RewriteResult> {
  const analysis = analyzeQuery(query, category);
  const confidence = computeConfidence(firstPassResults, scoreSource);
  const decision = makeRewriteDecision(analysis, confidence, thresholds);
  const candidates = await generateCandidates(decision, analysis);

  // Annotate LLM fallback for diagnostics (spec: 'llm_fallback_to_strong' note)
  if (decision.mode === 'strong-llm' && candidates.length > 0 && candidates.every((c) => c.strategy !== 'llm')) {
    decision.reason += ' [llm_fallback_to_strong]';
  }

  return { decision, candidates, analysis };
}
