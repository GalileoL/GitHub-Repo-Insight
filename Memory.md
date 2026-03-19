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

## 5) SSE Streaming Notes
- Server side:
  - Endpoint: `POST /api/rag/ask` with body `{ stream: true }`
  - Headers set in `api/rag/ask.ts`:
    - `Content-Type: text/event-stream`
    - `Cache-Control: no-cache`
    - `Connection: keep-alive`
    - `X-Accel-Buffering: no`
  - Event payloads:
    - `data: {"type":"delta","content":"..."}`
    - `data: {"type":"sources","sources":[...]}`
    - `data: [DONE]`
- Client side:
  - `src/features/rag/api/rag.ts` reads `fetch(...).body.getReader()`
  - Parses lines prefixed with `data: ` and dispatches delta/sources callbacks

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

## 7) Stream Interruption / Robustness Status
- Already handled:
  - Guard for missing `res.body` before streaming read
  - Per-line JSON parse wrapped in `try/catch` to skip malformed lines
- Not fully handled yet:
  - No explicit user cancel (AbortController)
  - No resume/reconnect protocol for dropped streams
  - No partial-answer recovery strategy after network interruption

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
- API contract changes (`api/rag/*`, request or response shape)
- Retrieval/rerank/LLM pipeline logic changes
- Stream payload format changes
- Markdown rendering capability changes
- Auth/rate-limit/security behavior changes
- Build scripts or required env vars change

## 11) Known Risks / Follow-Ups
- Stream UX can improve with stop/retry/reconnect.
- Markdown renderer may need expansion (lists/links/tables) if answer complexity grows.
- Keep security hardening notes aligned with `docs/plans/2026-03-18-security-hardening-checklist.md`.
