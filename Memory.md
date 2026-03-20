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
- `api/`: Vercel serverless endpoints (`auth`, `rag/ask`, `rag/ingest`, `rag/status`)
- `lib/rag/`: shared backend logic (auth, retrieval, llm, storage, chunking, github fetchers)
- `docs/plans/`: architecture and hardening notes
- `README.md`: user-facing docs
- `TROUBLESHOOTING.md`: local setup and debugging help

## 3) Main User Flows
- Repo analytics flow:
  - User enters `owner/repo`
  - Frontend hooks in `src/hooks/` call GitHub REST APIs
  - Data transformers map API responses to chart-ready shape
  - Chart components render language, commits, contributors, issues/PR trends, releases
- Ask Repo flow:
  - `AskRepoPanel` checks index status (`/api/rag/status`)
  - User triggers index (`/api/rag/ingest`) if needed
  - User asks question (`/api/rag/ask`, optional streaming)
  - Backend runs classify -> hybrid retrieval -> rerank -> LLM answer
  - Frontend renders answer and source citations

## 4) RAG Architecture (Key Files)
- API endpoints:
  - `api/rag/ask.ts`: auth, validation, rate-limit, retrieval, streaming/non-streaming answer
  - `api/rag/ingest.ts`: fetch GitHub data, chunk, embed, upsert
  - `api/rag/status.ts`: indexed/chunk count
- Retrieval:
  - `lib/rag/retrieval/router.ts`: query classification
  - `lib/rag/retrieval/hybrid.ts`: vector + keyword merge
  - `lib/rag/retrieval/rerank.ts`: result reranking
- LLM:
  - `lib/rag/llm/index.ts`: provider config, prompt, stream/non-stream answer generation
- Storage:
  - `lib/rag/storage/index.ts`: Upstash Vector operations + cached chunk count
- Auth and quotas:
  - `lib/rag/auth/index.ts`: GitHub token verify + daily ask/ingest limits in Redis

## 5) SSE Streaming Notes (UPDATED: Phase 1 Optimization)

### Protocol & Lifecycle (v2.0)
- Server side (`api/rag/ask.ts`):
  - Listens for client disconnect via `req.on('close', 'error')`
  - If detected, aborts upstream LLM stream and sends error event
  - Event format: `{ type: 'delta'|'sources'|'error', content?: string, message?: string, sources?: [] }`
  - Clean termination: `[DONE]` token ends stream
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

### Error Handling (v2.0)
- Server detects client disconnect and stops LLM computation
- Client handles parse errors per-line (continues on SyntaxError)
- Cleanly distinguishes cancelled vs error states
- Partial answers preserved for manual re-indexing or manual continuation

### Next Phase (TODO)
- Reconnect/resume protocol (save position in stream)
- Heartbeat events (prevent nginx/proxy timeout)
- Metrics: TTFB, duration, cancel rate, fail rate
- Dedicated tests for stream interruption scenarios

## 6) Markdown Rendering Notes
- Rendering is custom, not `react-markdown`.
- `src/utils/markdown-parser.tsx` (new):
  - Parses block-level markdown: paragraphs, code fences, blockquotes, tables, lists (nested), and metadata.
  - Supports Markdown inside table cells and list items (nested block parsing).
- `src/features/rag/components/AnswerCard.tsx`:
  - Renders markdown blocks into React elements via `renderBlocks`.
  - Supports inline markdown via `renderMarkdownInline`.
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

## 7) Stream Interruption / Robustness Status (UPDATED: Phase 1 Complete)
- ✅ Implemented on Phase 1:
  - Client-side AbortController for user-initiated cancel
  - Server detects client disconnect (req.on('close')) and stops LLM stream
  - Unified error event (`type: 'error'`) for both server and parse errors
  - Partial answer preservation on cancel
  - Retry mechanism via `useAskRepo.retry()`
- 🔄 In Progress:
  - Enhanced SSE parser for fragmented events
  - Remove timeout concerns
- ❌ Not yet implemented:
  - Reconnect protocol (resume from position)
  - Heartbeat events
  - Metrics & monitoring (TTFB, duration, cancel rate)
  - Comprehensive stream interrupt tests

## 8) Commands
- Install: `npm install`
- Frontend dev: `npm run dev`
- API dev (Vercel): `npm run dev:api`
- Build: `npm run build`
- Lint: `npm run lint`
- Preview: `npm run preview`

## 9) Environment Essentials
- OAuth:
  - `VITE_GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
- RAG core:
  - `OPENAI_API_KEY` (embeddings required)
  - `UPSTASH_VECTOR_REST_URL`
  - `UPSTASH_VECTOR_REST_TOKEN`
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- Provider switch:
  - `LLM_PROVIDER` in `openai|deepseek|groq|gemini|claude`
  - matching provider key env var
- Quota and admin:
  - `RAG_DAILY_LIMIT`
  - `RAG_DAILY_INGEST_LIMIT`
  - `ADMIN_GITHUB_USERS`

## 10) Virtual List Implementation

- **Component**: `src/components/charts/ReleaseTimeline.tsx`
- **Library**: `@tanstack/react-virtual` v3 (`useVirtualizer`)
- **Type**: Variable-height (不定高) — items with release notes body are taller (~92-96px) than tag-only items (~60-64px)
- **Mechanism**: `ref={virtualizer.measureElement}` + `data-index` on each item; ResizeObserver measures actual DOM height after first render; `estimateSize: () => 80` is initial estimate only
- **Body summary**: `stripMarkdown()` (module-scope) uses context-aware replacements (capturing groups for bold/italic, line-anchored `^` for headings/lists/blockquotes) — avoids corrupting `C#`, `bug-fix`, version strings. `truncateCodePoints(str, 160)` (early-exit iterator) replaces `[...str].slice()` for emoji-safe, allocation-efficient truncation → `line-clamp-2`
- **Data flow**: `GitHubRelease.body` → `transformReleases` (`body: release.body`) → `ReleaseTimelineData.body: string | null` (non-optional) → component
- `SourceList` also uses `@tanstack/react-virtual` but fixed-height (92px)

## 11) Update Checklist (When Editing This Repo)
Update this file when any of these changes happen:
- API contract changes (`api/rag/*`, request or response shape) ✓ track phase updates
- Retrieval/rerank/LLM pipeline logic changes
- Stream payload format changes ✓ SSE event type updates
- Markdown rendering capability changes
- Auth/rate-limit/security behavior changes
- Build scripts or required env vars change
- Stream control flow or status state changes ✓ useAskRepo exports

## 11) SSE Optimization Roadmap (All Phases)

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
- [ ] Add server-side telemetry / storage for stream metrics (e.g., send to Datadog or App Insights)
- [ ] Harden retry/resume logic against payload tampering
- [ ] Add intentional rate limiting for shared links
- [ ] Improve shared link UX with expiration notice
- Files: `lib/rag/metrics/index.ts`, `api/rag/*`, `src/features/rag/*`
**Documentation & Monitoring**
- [ ] Write stream interruption guide for users (when to expect cancel/retry)
- [ ] Add logging: stream lifecycle events (start, chunk received, complete, error)
- [ ] Dashboard: streaming stats (success rate, avg duration, cancel rate by repo)
- [ ] Alert on: high error rate, > threshold connection churn
- Files: `docs/`, (new) `lib/rag/logging/index.ts`, (new) `api/analytics/streams.ts`

## 12) Known Risks & Constraints
- Markdown renderer currently intentionally constrained; Phase 5 needed for full feature set
- Stream reconnect window: ~5 min (Redis TTL); after that partial answer is lost
- Vercel cold start may interrupt early deltas; Phase 2 heartbeat helps
- Multi-region deployments: stream state not shared (per-region only)
- Keep security hardening notes aligned with `docs/plans/2026-03-18-security-hardening-checklist.md`
