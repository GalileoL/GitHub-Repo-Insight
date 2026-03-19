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
- `src/features/rag/components/AnswerCard.tsx`:
  - Splits fenced code blocks with a small parser (`parseBlocks`)
  - Renders inline markdown with lightweight regex (`renderInlineMarkdown`)
  - Supports:
    - fenced code blocks ```lang
    - bold `**text**`
    - inline code `` `code` ``
    - `[Source N]` token rendering
- This is intentionally constrained for controlled LLM output.

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

## 10) Update Checklist (When Editing This Repo)
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
- [ ] Heartbeat events (every 15-30s) to prevent proxy timeout
- [ ] Request ID in event header for tracing
- [ ] Server-side metrics: stream start time, chunk count, error count
- [ ] Client-side metrics: TTFB, total duration, chunk rate
- [ ] Error categorization: network, server-side LLM, parsing, timeout
- Files to modify: `api/rag/ask.ts`, `src/features/rag/api/rag.ts`, (new) `lib/rag/metrics/index.ts`

### Phase 3 (Priority: High)
**Reconnect & Resume Protocol**
- [ ] Stream position tracking (byte offset or event sequence number)
- [ ] Save partial state to Redis (user ID, repo, question, position)
- [ ] Reconnect endpoint POST /api/rag/resume with position
- [ ] Resume from last received position (skip already-sent deltas)
- [ ] User-facing: "Reconnecting..." UI, auto-retry on network recover
- Files: `api/rag/ask.ts`, (new) `api/rag/resume.ts`, `src/features/rag/api/rag.ts`, `lib/rag/auth/index.ts`

### Phase 4 (Priority: Medium)
**Streaming Tests & Validation**
- [ ] Unit tests: SSE parser edge cases (fragmented frames, malformed JSON, timeouts)
- [ ] Integration tests: Abort during delta, reconnect mid-answer, network timeout scenarios
- [ ] E2E tests: Full flow with actual LLM, user cancel, retry sequence
- [ ] Load tests: Concurrent streams, connection churn
- Files: `src/features/rag/api/__tests__/rag.test.ts`, `api/rag/__tests__/ask.test.ts`

### Phase 5 (Priority: Medium)
**Markdown Renderer Enhancement**
- [ ] Support lists (unordered, ordered, nested)
- [ ] Support links with proper click handling
- [ ] Support tables (render as grid)
- [ ] Support blockquotes and emphasis variants
- [ ] Support images (if LLM outputs markdown image syntax)
- Files: `src/features/rag/components/AnswerCard.tsx`, (new) `src/utils/markdown-parser.ts`

### Phase 6 (Priority: Low)
**Advanced UX**
- [ ] Answer diff view on retry (show what changed)
- [ ] Inline edit for partial answers
- [ ] Export answer as markdown file
- [ ] Share partial answer with link (save to Redis cache)
- [ ] Keyboard shortcut for cancel (Escape)
- Files: `src/features/rag/components/AnswerCard.tsx`, `src/features/rag/components/AskRepoPanel.tsx`

### Phase 7 (Priority: Low)
**Performance & Optimization**
- [ ] Stream aggregation: batch small deltas to reduce React renders
- [ ] Lazy-load source links (defer GitHub fetch)
- [ ] Cache retrieved answers by repo+question hash (separate from user history)
- [ ] Pre-warm embeddings on repo index for faster first query
- Files: `src/features/rag/api/rag.ts`, `src/features/rag/hooks/useAskRepo.ts`, `lib/rag/storage/index.ts`

### Phase 8 (Priority: Low)
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
