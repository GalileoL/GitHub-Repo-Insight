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
