# Conditional Query Rewrite Playbook

Date: 2026-04-01
Scope: Ask Repo retrieval pipeline in GitHub Repo Insight

## 1. Why We Need Conditional Rewrite

Directly sending user queries to retrieval works for precise questions, but fails more often for:
- vague prompts (for example: "explain this")
- multi-intent prompts ("how auth works and what changed recently")
- implicit context or pronouns without antecedents
- comparative and negation-heavy wording

Our design is deterministic-first:
- always run original query first
- rewrite only when risk is high or first-pass confidence is low
- use LLM rewrite only as selective fallback

## 2. End-to-End Pipeline

Primary orchestrator: api/rag/ask.ts

Flow:
1. classifyQuery(question) to get category and typeFilter.
2. first-pass retrieval: hybridSearch(question, repo, 8, typeFilter).
3. analyzeAndRewrite(question, category, firstPass, 'rerank_boosted').
4. if decision.mode is none, keep firstPass.
5. else run rewrite candidates in parallel via hybridSearch(candidate.query, ...).
6. merge original + rewrite passes using mergeResults().
7. rerank merged set against original question.
8. generate answer and sources; emit diagnostics.

## 3. Query Analysis Internals

Implementation: lib/rag/retrieval/rewrite.ts

### 3.1 Anchor extraction

Extracts four anchor types from the query:
- filePaths
- endpoints
- codeSymbols
- directories

Anchors are explicit intent constraints and should be preserved in rewritten queries.

### 3.2 Risk signals

Boolean signals:
- isVague
- isComplex
- hasImplicitContext
- isComparative
- hasNegation

Weighted risk sum:
- isVague: 0.30
- isComplex: 0.25
- hasImplicitContext: 0.20
- isComparative: 0.15
- hasNegation: 0.10

### 3.3 Anchor discount

If anchors exist, risk score is discounted using the strongest available multiplier:
- filePaths: x0.5
- endpoints: x0.6
- codeSymbols: x0.7
- directories: x0.7

Only one multiplier is applied (best discount), not cumulative stacking.

## 4. Retrieval Confidence

Confidence is computed from first-pass scored chunks:
- topScore
- scoreGap (top1-top2)
- coverageRatio (fraction above 0.3 floor)
- avgScore

Weighted confidence:
- topScore: 0.35
- scoreGap: 0.25
- coverageRatio: 0.25
- avgScore: 0.15

If first pass is empty, all confidence values are 0.

## 5. Rewrite Decision Logic

Default thresholds:
- light: 0.30
- strong: 0.55
- llm: 0.80
- confidenceFloor: 0.30

Combined rewrite score:

rewriteScore = (riskScore * 0.6) + ((1 - confidenceScore) * 0.4)

Decision:
- none: rewriteScore < 0.30
- light: 0.30 <= rewriteScore < 0.55
- strong: 0.55 <= rewriteScore < 0.80
- strong-llm: rewriteScore >= 0.80, but only when:
  - no anchors exist, and
  - confidenceScore < confidenceFloor

If anchors exist, decision is capped at strong even at very high rewriteScore.

## 6. Candidate Generation Strategies

### 6.1 none
- no candidates

### 6.2 light
- one synonym/vocabulary normalization rewrite

### 6.3 strong
- synonym rewrite
- decomposition rewrite (split multi-topic query)
- concept expansion fallback
- dedupe and cap to at most 3 candidates

### 6.4 strong-llm
- ask LLM for up to 3 semantically distinct rewrites
- enforce anchor preservation in prompt and post-processing
- if LLM fails or returns empty, fall back to deterministic strong candidates

## 7. Merge and Ranking

Implementation: lib/rag/retrieval/merge.ts

Merge rules:
- deduplicate by chunk id
- mergedScore = max(original/rewrite scores) + (sourceCount - 1) * consensusBonus
- consensusBonus default: 0.05
- tie-breaker: when score diff <= 0.01, prefer chunks from original query

After merge, convert to ScoredChunk and rerank against original query for final topK.

## 8. Diagnostics and Observability

Structured diagnostics in ask.ts include:
- analysis (anchors, risk signals, risk score)
- firstPassConfidence
- decision (mode, reasonCodes, rewriteScore)
- candidates
- before/after retrieval snapshots
- timing and chunk counts

This supports offline threshold tuning and regression checks.

## 9. Design Trade-offs

Benefits:
- higher recall for difficult queries
- deterministic baseline for most traffic
- controlled LLM cost and latency
- explainable decisions through reason codes

Trade-offs:
- additional retrieval fan-out in strong/strong-llm modes
- double rerank behavior (hybrid internal rerank + final rerank after merge)
- score calibration depends on scoreSource (currently rerank_boosted)

## 10. Interview Questions and Suggested Answers

### Q1: Why not always rewrite every query?
A: Always rewriting adds latency and can distort already precise user intent. We first test retrieval quality with original query, then rewrite only when risk/confidence signals justify the cost.

### Q2: How do you prevent rewritten queries from losing critical terms?
A: We extract anchors (file paths, endpoints, symbols, directories) and force-preserve them in deterministic rewrites and LLM rewrites.

### Q3: How do you decide between light, strong, and strong-llm?
A: We compute rewriteScore from query risk and retrieval confidence. Threshold ranges map to modes; strong-llm is guarded by low confidence and zero anchors.

### Q4: Why does strong-llm require no anchors?
A: Anchored queries already carry precise intent. Deterministic rewrite is safer there. LLM rewrite is reserved for highly ambiguous unanchored queries where deterministic methods may be insufficient.

### Q5: How are retrieval confidence metrics chosen?
A: topScore, scoreGap, coverageRatio, and avgScore together capture both peak relevance and distribution quality, reducing false positives from a single high outlier.

### Q6: What does mergeResults optimize for?
A: It rewards both best-match relevance (max score) and multi-query agreement (consensus bonus), then uses original-query preference as tie-break to reduce rewrite over-bias.

### Q7: What happens if LLM rewrite fails?
A: We gracefully fall back to deterministic strong candidates, so the pipeline remains available and predictable.

### Q8: How do you evaluate whether rewrite helped?
A: We log before/after snapshots, overlap ratio, new chunk counts, and timing. This enables A/B style comparison and threshold tuning over real traffic.

### Q9: Why is there a second rerank after merge?
A: Each retrieval pass is optimized for its own query text. After merging, we need one final relevance alignment back to the original user question.

### Q10: How would you improve this next?
A: Add offline replay evaluation, per-category thresholds, dynamic candidate count limits, and optional raw-RRF confidence path to reduce calibration drift.

## 11. Practical Tuning Checklist

- Verify score distribution drift when rerank logic changes.
- Keep reasonCodes stable for dashboard analytics.
- Enforce hard timeout budget for rewrite fan-out.
- Monitor strong-llm frequency to control model cost.
- Recalibrate thresholds after major corpus composition changes.
