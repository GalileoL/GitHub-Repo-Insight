# Project Memory

This file is a compact, AI-friendly memory for this repository.
Keep it up to date when architecture, APIs, or conventions change.

## 1) Project Snapshot
- Name: GitHub Repo Insight
- Type: React + Vite dashboard with Vercel serverless APIs
- Core value: GitHub analytics + RAG-based "Ask Repo" Q&A
- Frontend: React 19, TypeScript, React Router, TanStack Query, Zustand, Tailwind v4
- Backend (serverless): Vercel functions under `api/`
- AI stack: OpenAI-compatible chat API (OpenAI/DeepSeek/Groq/Gemini/Claude), Upstash Vector, Upstash Redis

## 2) Top-Level Structure
- `src/`: frontend app (pages, components, hooks, stores, utils)
- `api/`: Vercel serverless endpoints (`auth/[action]`, `rag/ask`, `rag/ingest`, `rag/resume`, `rag/share`, `rag/status`, `rag/feedback`)
- `lib/rag/`: shared backend logic (auth, retrieval, llm, storage, chunking, github fetchers)
- `docs/plans/`: architecture and hardening notes
- `README.md`: user-facing docs
- `TROUBLESHOOTING.md`: local setup and debugging help

## 3) Main User Flows
- Repo analytics flow:
  - User enters `owner/repo`
  - Frontend hooks in `src/hooks/` call GitHub APIs (repo overview + languages share one GraphQL snapshot query)
  - Contributors are aggregated from GraphQL commit history (REST fallback enabled)
  - Monthly issue/PR trend counts are fetched via one GraphQL aliased search query
  - Data transformers map API responses to chart-ready shape
  - Chart components render language, commits, contributors, issues/PR trends, releases
- Ask Repo flow:
  - `AskRepoPanel` checks index status (`/api/rag/status`)
  - User signs in via `/api/auth/start` (served by `api/auth/[action].ts`, server-generated state + PKCE), callback exchanges code at `/api/auth/github`
  - Auth session is stored in signed HttpOnly cookie (`gh_app_session`)
  - User triggers index (`/api/rag/ingest`) if needed
  - User asks question (`/api/rag/ask`, optional streaming)
  - Backend runs classify -> hybrid retrieval -> **conditional query rewrite** -> merge -> rerank -> **code fetch stage (code queries only)** -> LLM answer
  - Frontend renders answer and source citations
  - User can optionally create a share link, which is stored in Redis and expires after 7 days
  - Pure analytics intent path can return deterministic answers directly (bypasses RAG retrieval/LLM rewriting)

## 4) RAG Architecture (Key Files)
- API endpoints:
  - `api/auth/[action].ts`: consolidated auth endpoint for `start|github|session|logout`; kept to one function because Vercel Hobby deployments fail above 12 serverless functions
  - `api/rag/ask.ts`: auth, validation, rate-limit, retrieval, **conditional query rewrite**, **code fetch stage**, streaming/non-streaming answer, eval event writes
- `api/rag/ingest.ts`: fetch GitHub data via a GraphQL repository snapshot, chunk (including **code_summary**), embed, upsert (REST fallback only when needed); successful responses now surface `codeSummaryCount` plus `codeSummaryFailed/codeSummaryFailureReason` when source indexing degrades
- `api/rag/resume.ts`: resume interrupted SSE answer streams from Redis checkpoints (partial answer + exact prompt context); when a snapshot is missing it rebuilds retrieval, re-runs code-fetch enrichment for code queries, writes eval events, and updates code-fetch alert streaks
  - `api/rag/share.ts` / `api/rag/share/[id].ts`: persist and load share links from Redis; share creation writes eval feedback
  - `api/rag/status.ts`: indexed/chunk count
- `api/rag/feedback.ts`: request-level feedback endpoint (share/retry/thumbs) — validates `requestId` ownership against the stored retrieval login before writing `feedback:*`
- Retrieval:
  - `lib/rag/retrieval/router.ts`: query classification (5 categories: documentation/community/changes/general/**code**); code queries get `typeFilter: ['code_summary']`
  - `lib/rag/retrieval/hybrid.ts`: vector + keyword merge (RRF K=60, internally calls rerank); passes `queryCategory` to both keyword and vector paths so non-code queries exclude `code_summary` on both legs
  - `lib/rag/retrieval/keyword.ts`: K1 isolation — non-code queries exclude `code_summary`; code queries include only `code_summary`
  - `lib/rag/retrieval/rerank.ts`: heuristic reranker (recency +0.15, content length +0.10, title match +0.05/term)
  - `lib/rag/retrieval/rewrite.ts`: conditional query rewrite (analysis, confidence, decision, candidates)
  - `lib/rag/retrieval/merge.ts`: multi-pass result merge, dedup, diagnostic snapshots
- Chunking:
  - `lib/rag/chunking/code-summary.ts`: TS/JS AST extractor (TypeScript Compiler API) + regex fallback for other languages; outputs `code_summary` chunks with `symbolNames`, `language`, `lastIndexedSha`, and truncation metadata
  - `lib/rag/chunking/index.ts`: orchestrates all chunk types including new `code_summary`
- Runtime enrichment:
  - `lib/rag/code-fetch.ts`: shared code-query source enrichment used by both `api/rag/ask.ts` and `api/rag/resume.ts`; exports `extractCodeWindow`, `codeFetchStage`, and code-fetch alert helpers
- LLM:
  - `lib/rag/llm/index.ts`: provider config, prompt (real source code takes priority over summaries), stream/non-stream answer generation, `rewriteQueries()` for strong-llm mode
- Storage:
  - `lib/rag/storage/index.ts`: Upstash Vector ops; **K2 physical split** via `fetchCoreRepoChunks` (readme/issue/pr/release/commit prefix scans) and `fetchCodeSummaryChunks` (`{repo}:code:` prefix); Redis helpers for chunk counts, stream sessions, share entries, **eval events** (`writeEvalEventBatch`, `writeEvalFeedback`, `getEvalFields`) and per-day eval secondary indexes (`rag:eval:index:{YYYY-MM-DD}`)
- Ops / monitoring:
  - `lib/admin/alert-manager.ts`: Redis-backed streak / threshold alerts with suppress keys
  - `lib/admin/metrics-aggregator.ts`: indexed daily metrics hydration from eval hashes
  - `lib/admin/report-renderer.ts`: markdown daily report formatter
  - `lib/admin/notifier.ts`: scenario-aware notification routing (`Webhook -> Resend -> structured log` for live alerts, `Resend -> structured log` for daily report)
  - `api/admin/report.ts`: CRON-protected daily report endpoint; when `date` is omitted it reports the previous UTC day by default
- Auth and quotas:
  - `lib/rag/auth/index.ts`: session-cookie auth, GitHub token verify/refresh, daily ask/ingest limits in Redis
- GitHub API client:
  - `src/api/github.ts`: shared frontend GitHub client with `If-None-Match` conditional caching for REST GETs, GraphQL dashboard snapshot, GraphQL contributors aggregation (with REST fallback), and GraphQL monthly issue/PR aliased counting
  - `lib/rag/github/fetchers.ts`: server-side GitHub fetchers; **`fetchFileContentDetailed`** for on-demand source code fetch with classified failure reasons (`not_found | forbidden | too_large | timeout | rate_limited | unknown`); two-phase file prioritization for ingest
- Types:
  - `lib/rag/types.ts`: all shared types including 15 query rewrite interfaces, `code_summary` ChunkType, `code` QueryCategory, code/eval metadata types, `FileFetchFailureReason`

## 5) Conditional Query Rewrite Pipeline (NEW — 2026-03-31)

Design principle: **deterministic-first, selective LLM fallback only.**

### Pipeline Flow (in ask.ts)
```
classifyQuery(question) → { category, typeFilter }
hybridSearch(original)  → firstPass results (rerank-boosted scores)
analyzeAndRewrite(question, category, firstPass) → { decision, candidates, analysis }
  ├── analyzeQuery() → anchors, risk signals, risk score
  ├── computeConfidence() → retrieval confidence score
  ├── makeRewriteDecision() → mode (none/light/strong/strong-llm)
  └── generateCandidates() → rewrite candidates
hybridSearch(candidate1, candidate2, ...) → parallel fan-out
mergeResults(firstPass, rewritePasses) → dedupe by chunk ID, max-wins + consensus bonus
rerank(merged, original, topK=8)  → second rerank pass against original query
generateAnswer/Stream() → LLM answer
```

### Scoring
- **Query Risk Score (0–1):** weighted boolean signals — vague (0.30), complex (0.25), implicit context (0.20), comparative (0.15), negation (0.10). Anchor discount: filePaths ×0.5, endpoints ×0.6, codeSymbols ×0.7, directories ×0.7 (lowest wins, don't stack)
- **Retrieval Confidence (0–1):** topScore (0.35), normalizedGap (0.25), coverageRatio (0.25), avgScore (0.15). Absolute coverage floor of 0.3
- **Combined:** `rewriteScore = (riskScore × 0.6) + ((1 - confidenceScore) × 0.4)`

### Rewrite Modes
| Mode | Interval | Candidates | Extra latency |
|------|----------|------------|---------------|
| `none` | [0, 0.3) | 0 | ~0ms |
| `light` | [0.3, 0.55) | 1 (synonym) | ~200-400ms |
| `strong` | [0.55, 0.8) | 2-3 (synonym + decompose/expand) | ~200-400ms |
| `strong-llm` | [0.8, 1.0] | 2-3 (LLM-generated) | ~700-900ms |

**strong-llm guard:** ALL three required: rewriteScore ≥ 0.8, confidenceScore < 0.3, all anchors empty. Falls back to deterministic strong on LLM failure.

### Merge Strategy
- Max-wins scoring: `max(originalScore, ...rewriteScores) + (sourceCount - 1) × 0.05`
- Exact-ID dedup via `Map<string, MergedChunk>`
- Tie-break within 0.01: prefer chunks from original query (`fromOriginal: true`)
- Double-rerank: hybridSearch internally reranks; final rerank on merged set against original query (intentional)

### Structured Logging
Single JSON log line per request with: mode, reasonCodes, rewriteScore, riskScore, confidenceScore, anchorTypes, candidateCount, overlap, timing, counts.

### Test Coverage
- 37 tests in `rewrite.test.ts` (anchors, risk signals, scoring, confidence, decision, candidates, analyzeAndRewrite)
- 10 tests in `merge.test.ts` (dedup, max-wins, consensus bonus, tie-break, snapshots)
- 7 existing tests in `rag.test.ts` (SSE streaming — unaffected)

### Spec & Plan
- Design spec: `docs/superpowers/specs/2026-03-31-conditional-query-rewrite-design.md`
- Implementation plan: `docs/superpowers/plans/2026-03-31-conditional-query-rewrite.md`

## 6) SSE Streaming Notes (UPDATED: Phase 1 Optimization)

### Protocol & Lifecycle (v2.0)
- Server side (`api/rag/ask.ts`):
  - Listens for client disconnect via `req.on('close', 'error')`
  - If detected, aborts upstream LLM stream and sends error event
  - Event format: `{ type: 'delta'|'sources'|'error', content?: string, message?: string, sources?: [] }`
  - Clean termination: `[DONE]` token ends stream
- Resume side (`api/rag/resume.ts`):
  - Reuses the Redis checkpoint containing the exact prompt context and partial answer
  - Continues generation from the stored assistant output instead of re-running retrieval
- Client side (`src/features/rag/api/rag.ts`):
  - Accepts `AbortSignal` for cancellation
  - Parses events with error handling for fragmented SSE
  - Dispatches via callbacks: onDelta, onSources, onError, onStatus

### User Control (v2.0)
- `useAskRepo` hook exports: `cancel()`, `retry()`, `streamStatus`, `streamError`
- Stream states: `idle` | `connecting` | `streaming` | `done` | `cancelled` | `error`
- UI (`AnswerCard`, `AskRepoPanel`):
  - Shows "Stop" button during streaming
  - Shows "Retry" button if cancelled
  - Preserves partial answer on cancel

### Error Handling (v2.1)
- Server detects client disconnect and stops LLM computation
- Client handles parse errors per-line (continues on SyntaxError)
- Cleanly distinguishes cancelled vs error states
- Partial answers preserved for manual re-indexing or manual continuation
- **Stop → Retry bug fixed (2026-03-20):** resume path was not falling back when session not found (404), causing error state + empty red box instead of a fresh ask. Fix: detect `session not found` in `performResume` catch → clear `requestIdRef` → `mutation.mutate(question)`. Also fixed `AskRepoPanel` error box to show `streamError ?? mutation.error?.message` (were different error sources).

### Next Phase (TODO)
- E2E tests for full interruption/retry paths
- Stream telemetry sink integration (external dashboarding)
- Resume hardening against payload tampering

## 7) Markdown Rendering Notes
- Rendering is custom, not `react-markdown`.
- `src/utils/markdown-parser.tsx` (new):
  - Parses block-level markdown: paragraphs, code fences, blockquotes, tables, lists (nested), and metadata.
  - Supports Markdown inside table cells and list items (nested block parsing).
- `src/features/rag/components/AnswerCard.tsx`:
  - Renders markdown blocks into React elements via `renderBlocks`.
  - Supports inline markdown via `renderMarkdownInline`.
  - Applies URL allowlist checks before rendering markdown links/images as clickable/loaded content.
  - Supports:
    - fenced code blocks ```lang (syntax highlighted via Prism.js)
    - bold `**text**`, italic `*text*`
    - links `[text](url)`
    - images `![alt](src)`
    - tables (markdown table syntax)
    - nested lists and nested block parse inside list items
    - blockquotes (`> quote`)
  - Provides copy-to-clipboard on code blocks + download-as-markdown button in UI.
- This is intentionally constrained for controlled LLM output; avoids a full markdown renderer.
- Server-side sources are URL-sanitized in `lib/rag/llm/index.ts` before SSE/non-stream responses; blocked URLs are downgraded to empty strings and rendered as non-clickable in `SourceList`.

## 8) Stream Interruption / Robustness Status (UPDATED: Phase 1 Complete)
- ✅ Implemented on Phase 1:
  - Client-side AbortController for user-initiated cancel
  - Server detects client disconnect (req.on('close')) and stops LLM stream
  - Unified error event (`type: 'error'`) for both server and parse errors
  - Partial answer preservation on cancel
  - Retry mechanism via `useAskRepo.retry()`
- ✅ Implemented beyond Phase 1:
  - Heartbeat events in streaming paths
  - Resume endpoint with Redis checkpoint replay
  - Server/client stream metrics and error categorization
  - Deterministic analytics-only SSE excludes resumable session persistence (prevents resume/LLM drift)
  - Shared GitHub GETs cache `304 Not Modified` responses locally via `If-None-Match`
- ❌ Not yet implemented:
  - E2E interruption/retry tests with real providers
  - External telemetry sink and dashboards

## 9) Commands
- Install: `pnpm install`
- Frontend dev: `pnpm dev`
- API dev (Vercel): `pnpm dev:api`
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Preview: `pnpm preview`

## CI Checks
- `.github/workflows/ci.yml`: runs `pnpm install --frozen-lockfile`, `pnpm exec tsc -b`, `pnpm lint`, `pnpm test`, `pnpm build`
- Trigger scope: PRs to `main` and pushes to `main`

## 10) Environment Essentials
- GitHub App auth:
  - `GITHUB_APP_CLIENT_ID`
  - `GITHUB_APP_CLIENT_SECRET`
  - `AUTH_SESSION_SECRET` (required for cookie signing)
  - `GITHUB_AUTH_CALLBACK_URL` (optional override)
- Dashboard GitHub API requests go through `/api/github`; the browser no longer holds a GitHub token.
- RAG core:
  - `OPENAI_API_KEY` (embeddings required)
  - `UPSTASH_VECTOR_REST_URL`
  - `UPSTASH_VECTOR_REST_TOKEN`
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- Provider switch:
  - `LLM_PROVIDER` in `openai|deepseek|groq|gemini|claude`
  - matching provider key env var
- URL allowlists:
  - `RAG_ALLOWED_URL_ORIGIN_PATTERNS` (server-side source URL validation)
  - `VITE_ALLOWED_URL_ORIGIN_PATTERNS` (frontend markdown/source rendering validation)
- Quota and admin:
  - `RAG_DAILY_LIMIT`
  - `RAG_DAILY_INGEST_LIMIT`
  - `ADMIN_GITHUB_USERS`

## 11) Virtual List Implementation

- **Component**: `src/components/charts/ReleaseTimeline.tsx`
- **Library**: `@tanstack/react-virtual` v3 (`useVirtualizer`)
- **Type**: Variable-height (不定高) — items with release notes body are taller (~92-96px) than tag-only items (~60-64px)
- **Mechanism**: `ref={virtualizer.measureElement}` + `data-index` on each item; ResizeObserver measures actual DOM height after first render; `estimateSize: () => 80` is initial estimate only
- **Body summary**: `stripMarkdown()` (module-scope) uses context-aware replacements (capturing groups for bold/italic, line-anchored `^` for headings/lists/blockquotes) — avoids corrupting `C#`, `bug-fix`, version strings. `truncateCodePoints(str, 160)` (early-exit iterator) replaces `[...str].slice()` for emoji-safe, allocation-efficient truncation → `line-clamp-2`
- **Data flow**: `GitHubRelease.body` → `transformReleases` (`body: release.body`) → `ReleaseTimelineData.body: string | null` (non-optional) → component
- `SourceList` also uses `@tanstack/react-virtual` but fixed-height (92px)

## Redis Usage Summary

- `rag:usage:<login>:<YYYY-MM-DD>`: ask quota counter, 48h TTL
- `rag:ingest:<login>:<YYYY-MM-DD>`: ingest quota counter, 48h TTL
- `rag:chunk-count:<repo>`: cached indexed chunk count for status/fast-fail checks
- `rag:stream:snapshot:<requestId>`: SSE resume snapshot (repo/question/context/sources), 5 min TTL
- `rag:stream:progress:<requestId>`: SSE progress checkpoint (lastSeq/partialAnswer), 5 min TTL
- `rag:stream:<requestId>`: legacy combined session key kept for backwards compatibility
- `rag:share:<shareId>`: shared answer payload, 7 day TTL
- `rag:eval:<requestId>`: per-request evaluation hash (retrieval/code_fetch/answer/feedback events), 48h TTL
- `rag:eval:index:<YYYY-MM-DD>`: per-day requestId set used by daily report aggregation, 48h TTL by default
- `rag:alert:streak:<type>:<repo>`: Redis streak counters for live alerts
- `rag:alert:suppress:<type>:<repo>`: alert suppress keys to avoid duplicate notifications

## 12) Update Checklist (When Editing This Repo)
Update this file when any of these changes happen:
- API contract changes (`api/rag/*`, request or response shape) ✓ track phase updates
- Retrieval/rerank/LLM pipeline logic changes
- Stream payload format changes ✓ SSE event type updates
- Markdown rendering capability changes
- Auth/rate-limit/security behavior changes
- Build scripts or required env vars change
- Stream control flow or status state changes ✓ useAskRepo exports

## 13) SSE Optimization Roadmap (All Phases)

### Phase 1 ✅ (2026-03-19 — COMPLETE)
- [x] Client AbortController support
- [x] Server client-disconnect detection (req.on 'close'/'error')
- [x] Unified error event protocol
- [x] useAskRepo: cancel(), retry(), streamStatus, streamError exports
- [x] UI: Stop button, Retry on cancel, status indicators
- [x] Partial answer preservation on user cancel

### Phase 2 (Priority: High)
**Reliability & Observability**
- [x] Heartbeat events (every 15-30s) to prevent proxy timeout
- [x] Request ID in event header for tracing
- [x] Server-side metrics: stream start time, chunk count, error count
- [x] Client-side metrics: TTFB, total duration, chunk rate
- [x] Error categorization: network, server-side LLM, parsing, timeout
- Files to modify: `api/rag/ask.ts`, `src/features/rag/api/rag.ts`, (new) `lib/rag/metrics/index.ts`

### Phase 3 (Priority: High)
**Reconnect & Resume Protocol**
- [x] Stream position tracking (byte offset or event sequence number)
- [x] Save partial state to Redis (user ID, repo, question, position)
- [x] Reconnect endpoint POST /api/rag/resume with position
- [x] Resume from last received position (skip already-sent deltas)
- [x] User-facing: "Reconnecting..." UI, auto-retry on network recover
- Files: `api/rag/ask.ts`, (new) `api/rag/resume.ts`, `src/features/rag/api/rag.ts`, `lib/rag/auth/index.ts`, `lib/rag/storage/index.ts`

### Phase 4 (Priority: Medium)
**Streaming Tests & Validation**
- [x] Unit tests: SSE parser edge cases (fragmented frames, malformed JSON, timeouts)
- [x] Integration tests: Abort during delta, reconnect mid-answer, network timeout scenarios (simulated via mocked fetch)
- [ ] E2E tests: Full flow with actual LLM, user cancel, retry sequence
- [ ] Load tests: Concurrent streams, connection churn
- Files: `src/features/rag/api/rag.test.ts` (+ existing validation scripts)

### Phase 5 (Priority: Medium)
**Markdown Renderer Enhancement**
- [x] Support lists (unordered, ordered, nested)
- [x] Support links with proper click handling
- [x] Support tables (render as grid)
- [x] Support blockquotes and emphasis variants
- [x] Support images (if LLM outputs markdown image syntax)
- [x] Add syntax highlighting for fenced code blocks (Prism.js)
- [x] Download answer as markdown file
- Files: `src/features/rag/components/AnswerCard.tsx`, (new) `src/utils/markdown-parser.tsx`

### Phase 6 (Priority: Low)
**Advanced UX**
- [x] Answer diff view on retry (show what changed)
- [ ] Inline edit for partial answers
- [x] Export answer as markdown file
- [ ] Share partial answer with link (save to Redis cache)
- [x] Keyboard shortcut for cancel (Escape)
- Files: `src/features/rag/components/AnswerCard.tsx`, `src/features/rag/components/AskRepoPanel.tsx`

### Phase 7 (Priority: Low)
**Performance & Optimization**
- [x] Stream aggregation: batch small deltas to reduce React renders
- [x] Lazy-load source links (toggle view in SourceList)
- [x] Cache retrieved answers by repo+question hash (localStorage)
- [x] Pre-warm embeddings on repo index for faster first query (best-effort)
- Files: `src/features/rag/hooks/useAskRepo.ts`, `lib/rag/llm/index.ts`, `api/rag/ingest.ts`, `lib/rag/storage/index.ts`

### Phase 8 (Priority: Low)
**Monitoring & hardening**
- [x] Add Redis-backed eval indexing, daily report aggregation, and notifier-based ops alerts
- [ ] Harden retry/resume logic against payload tampering
- [ ] Add intentional rate limiting for shared links
- [ ] Improve shared link UX with expiration notice
- Files: `lib/rag/metrics/index.ts`, `api/rag/*`, `src/features/rag/*`
**Documentation & Monitoring**
- [ ] Write stream interruption guide for users (when to expect cancel/retry)
- [x] Add logging: stream lifecycle events (start, chunk received, complete, error)
- [ ] Dashboard: streaming stats (success rate, avg duration, cancel rate by repo)
- [x] Alert on: timeout streak / ingest failure streak / low GitHub rate limit thresholds via notifier
- Files: `docs/`, (new) `lib/rag/logging/index.ts`, (new) `api/analytics/streams.ts`

## 16) Code Summary + On-Demand Fetch Pipeline (NEW — 2026-04-17)

### Overview
Ingest now extracts code summaries from TS/JS source files (+ regex fallback for other languages) and stores them as `code_summary` chunks. When a user asks a code-related question, the ask pipeline fetches actual source files on demand for accurate answers.

### Ingest Changes
- File tree fetched from GitHub Contents API; filtered to `src/**`, `lib/**`, `api/**`; capped at 200 files
- Two-phase priority: (1) hard-protected entry points (`api/**/*.ts`, `lib/**/index.ts`, `src/App.tsx`), (2) remaining slots sorted by `changeFrequency×0.4 + prHitCount×0.3 + exportCount×0.2 + fileSizeInverse×0.1`
- Code summary chunk ID format: `{repo}:code:{normalizedFilePath}` where `filePath` is NFC-normalized and `:` is escaped as `%3A`
- `symbolNames` (capped), `symbolsTruncated`, `language`, `summaryTruncated` stored in metadata

### Ask Pipeline — Code Fetch Stage
```
classifyQuery → category='code'
hybridSearch (K1: code_summary only in keyword path; K2: fetchCodeSummaryChunks prefix scan)
rerank → codeFetchStage → generateAnswer
```
- `codeFetchStage` runs only when `category === 'code'`
- Scores candidate files by rerank score + filePath hit + symbol hit + entry-point hit
- Fetches up to 3 files concurrently; 2s per-file timeout, 3s total (`Promise.race` + AbortController)
- Files > 100 KB skipped
- Symbol window extraction: finds symbol in fetched content, extracts ±50-100 lines; falls back to file head
- Per-file cap: 2500 chars; total cap: 6000 chars
- Failure degrades to summary-only; classified reason stored in eval event

### K1/K2 Retrieval Isolation
- **K1 (logical):** both `keywordSearch` and `vectorSearch` receive `queryCategory`; non-code queries exclude `code_summary`
- **K2 (physical):** `fetchCoreRepoChunks` scans `{repo}:readme:`, `{repo}:issue:`, etc. separately; `fetchCodeSummaryChunks` scans `{repo}:code:` prefix — code_summary vectors never touch the wire for non-code queries

### Eval Events
Each ask/resume request writes a `rag:eval:{requestId}` Redis Hash (48h TTL) with fields:
- `retrieval`: category, topK, scores
- `code_fetch` (code path only): selectedFiles, failedFiles (with classified reason), usedSummaryOnlyFallback
- `answer`: model, answerUsedRetrievedCode
- `feedback:*`: written via `/api/rag/feedback` or share creation as independent hash fields (`feedback:thumbsUp`, `feedback:userRetried`, etc.) so concurrent writes do not overwrite each other
- Eval writes now index the requestId set first, then batch-write request fields to reduce half-written / unindexed hashes

### Phase 2 Future Work (Not Yet Implemented)
- Multi-language high-precision AST (Python, Go, Rust, Java)
- Incremental indexing (currently full rebuild on every ingest)
- Upstash namespace separation for code_summary vs core chunks
- K2 server-side metadata filter POC (Upstash `range()` prefix is current approach)
- External dashboarding beyond the current Redis-backed daily report + notifier pipeline

## 14) Known Risks & Constraints
- Markdown renderer currently intentionally constrained; Phase 5 needed for full feature set
- Stream reconnect window: ~5 min (Redis TTL); after that partial answer is lost
- Vercel cold start may interrupt early deltas; Phase 2 heartbeat helps
- Multi-region deployments: stream state not shared (per-region only)
- Keep security hardening notes aligned with `docs/plans/2026-03-18-security-hardening-checklist.md`

## 15) Memory Sync Template

Use this checklist whenever architecture/workflow behavior changes.

### Canonical-first update order
1. Update this file (`Memory.md`) first as the canonical long-form memory.
2. Update `README.md` for user-facing runtime/workflow changes.
3. Update runtime repository memory snapshots (for example, `/memories/repo/` when available in the agent runtime) as condensed operational facts.
4. Ensure runtime repository memory snapshots do not conflict with `Memory.md`.

### Minimal sync checklist
- [ ] Core flows changed? Update sections `3`, `4`, and relevant roadmap/status sections.
- [ ] API contract changed? Update endpoint bullets and request/response notes.
- [ ] SSE/retry behavior changed? Update sections `6`, `8`, and Redis key notes if needed.
- [ ] Build/test/CI changed? Update commands and CI summary.
- [ ] Env vars changed? Update section `10` and README env table.
- [ ] Added/removed major modules? Update top-level structure and architecture map.

### Commit note convention (recommended)
- Include `memory-sync` in docs commit messages touching `Memory.md` and related memory-sync artifacts.
