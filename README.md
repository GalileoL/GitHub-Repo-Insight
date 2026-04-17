# GitHub Repo Insight

A GitHub repository analytics dashboard that visualizes commit activity, language distribution, contributors, issues, pull requests, and releases with interactive charts — plus an AI-powered "Ask Repo" feature for natural-language Q&A over any repository.

Built as a frontend engineering showcase using modern React patterns.

**Live:** [https://githubrepoinsight.xyz](https://githubrepoinsight.xyz)

![GitHub Repo Insight](https://img.shields.io/badge/status-live-brightgreen) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-blue)

## Screenshots

Below are sample screenshots of the main dashboard and the Ask Repo AI view:

![Dashboard view](/image/image.png)
![AI_analyze_page](/image/image-1.png)

## Features

- **Repository Search** — Enter `owner/repo` or paste a GitHub URL to explore any public repository
- **Repository Overview** — Stars, forks, watchers, open issues, license, and metadata at a glance
- **Language Distribution** — Donut chart showing code breakdown by language
- **Top Contributors** — Horizontal bar chart of the most active contributors
- **Commit Trend** — Weekly commit activity over the past year as an area chart
- **Issues & PRs** — Monthly creation trend for issues and pull requests
- **Release Timeline** — Scrollable vertical timeline of the latest releases
- **Commit Heatmap** — GitHub-style calendar grid of daily commit activity
- **Draggable Dashboard** — Drag-and-drop to reorder dashboard cards; layout persisted to localStorage
- **GitHub App Auth** — Optional sign-in via server-managed OAuth (state + PKCE + HttpOnly session cookie)
- **Ask Repo (AI)** — Ask natural-language questions about any indexed repository, powered by RAG
- **SSE Streaming** — LLM answers stream token-by-token with a live typing cursor
- **Multi-LLM Support** — Switch between OpenAI, DeepSeek, Groq, Gemini, and Claude via a single env var
- **On-Demand Indexing** — One-click ingestion of README, issues, PRs, releases, commits, and **TypeScript/JavaScript source files** into a vector database
- **Source Code Indexing** — Extracts exported symbols, signatures, imports, and JSDoc from TS/JS source files using the TypeScript Compiler API; stores as searchable `code_summary` chunks
- **Code-Aware Q&A** — Code-related questions trigger on-demand GitHub source fetches (up to 3 files, with symbol-window extraction) for precise implementation answers
- **Hybrid Retrieval** — Combines vector similarity + keyword search with query routing and reranking; code queries are physically isolated from prose chunks
- **Conditional Query Rewrite** — Automatically analyzes query risk and retrieval confidence to trigger synonym expansion, query decomposition, or LLM-based reformulation for improved retrieval on vague/complex questions
- **Shareable Answers** — Save a generated answer and its citations to a short-lived share link
- **Cited Answers** — AI answers include clickable source citations linking back to GitHub
- **Q&A History** — Locally cached question history with instant recall (no re-query)
- **Recent Search** — Locally stored search history for quick re-access
- **Light / Dark / System Theme** — GitHub-inspired color palette with automatic system detection

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | React 19, TypeScript 5.9 |
| Build Tool | Vite 7 |
| Styling | TailwindCSS 4 |
| Routing | React Router 7 |
| Server State | TanStack Query 5 |
| Client State | Zustand 5 |
| Charts | ECharts 6 (tree-shaken) |
| Dates | dayjs |
| Validation | Zod 4 |
| AI / LLM | OpenAI, DeepSeek, Groq, Gemini, Claude (via OpenAI SDK compatible interface) |
| Drag & Drop | @dnd-kit (core + sortable) |
| Vector DB | Upstash Vector (serverless, HTTP-based) |
| Keyword Search | MiniSearch (in-memory BM25-like) |
| Cache / State | Upstash Redis (rate limits, chunk-count cache, stream sessions, share links) |
| Deployment | Vercel (with Serverless Functions for OAuth + RAG API) |

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 10+

### Installation

```bash
git clone https://github.com/your-username/github-repo-insight.git
cd github-repo-insight
pnpm install
```

### Environment Variables

Copy the example env file and fill in your GitHub App credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_CLIENT_ID` | GitHub App OAuth client ID (server-side login redirect flow) |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret (server-side only) |
| `AUTH_SESSION_SECRET` | Random secret used to sign HttpOnly auth session cookies |
| `GITHUB_AUTH_CALLBACK_URL` | Optional fixed callback URL (`https://your-domain.com/auth/callback`) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings (always required for Ask Repo) |
| `UPSTASH_VECTOR_REST_URL` | Upstash Vector database REST endpoint |
| `UPSTASH_VECTOR_REST_TOKEN` | Upstash Vector authentication token |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (for rate limiting, chunk-count caching, stream sessions, and share links) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis authentication token |
| `LLM_PROVIDER` | LLM provider: `openai` \| `deepseek` \| `groq` \| `gemini` \| `claude` (default: `openai`) |
| `DEEPSEEK_API_KEY` | DeepSeek API key (required when `LLM_PROVIDER=deepseek`) |
| `GROQ_API_KEY` | Groq API key (required when `LLM_PROVIDER=groq`) |
| `GEMINI_API_KEY` | Google Gemini API key (required when `LLM_PROVIDER=gemini`) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (required when `LLM_PROVIDER=claude`) |
| `RAG_ALLOWED_URL_ORIGIN_PATTERNS` | Server-side allowlist for source URLs in RAG responses. Comma-separated origin/host patterns, e.g. `https://github.com,https://*.githubusercontent.com` |
| `VITE_ALLOWED_URL_ORIGIN_PATTERNS` | Frontend allowlist for markdown links/images and source links in Ask Repo UI. Comma-separated origin/host patterns |
| `RAG_DAILY_LIMIT` | Max questions per user per day (default: `20`) |
| `RAG_DAILY_INGEST_LIMIT` | Max index/re-index operations per user per day (default: `5`) |
| `ADMIN_GITHUB_USERS` | Comma-separated GitHub usernames with unlimited usage |

> **Note:** The dashboard works without login (limited to anonymous GitHub rate limits) and without AI keys (the Ask Repo feature will be unavailable). To create a GitHub App, go to [GitHub App settings](https://github.com/settings/apps), enable OAuth user authorization, and configure callback URL as `/auth/callback`. Ask Repo login now uses server-managed HttpOnly session cookies with state + PKCE, and GitHub API requests from the dashboard are proxied through the server so the browser does not hold a GitHub token. For Upstash Vector, sign up at [upstash.com](https://upstash.com) and create a Vector index with 1536 dimensions. For Upstash Redis, create a Redis database at [upstash.com](https://upstash.com). Ask Repo requires GitHub login; regular users are limited to `RAG_DAILY_LIMIT` questions/day (default 20). Redis is also required for chunk-count caching, stream resume, and share links.

### Development

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
pnpm build
pnpm preview
```

### Testing & Quality

```bash
pnpm test
pnpm lint
```

- Tests are organized under `test/` with `test/unit/` and `test/integration/`.
- CI in `.github/workflows/ci.yml` runs type-check, lint, test, and build on PRs to `main` and pushes to `main`.

## Project Architecture

## AI Project Memory

For AI-assisted development and onboarding, see:

- `Memory.md` — concise architecture, API contracts, SSE/markdown behavior, and maintenance checklist
- `AGENTS.md` — canonical AI workflow (risk-based review/test policy + branch/PR flow)
- Runtime repository memory snapshots (when available in the active agent environment) — concise operational facts kept in sync after repo scans
- GitHub ingestion now uses a GraphQL repository snapshot for README / issues / PRs / releases / commits, while shared GitHub GETs cache `304 Not Modified` responses via `If-None-Match`

```
src/
├── api/            # Same-origin GitHub API client (server proxy + ETag-backed GET caching)
├── assets/         # Static assets
├── components/
│   ├── charts/     # ECharts-based visualization components (lazy-loaded)
│   ├── common/     # Reusable UI primitives (SearchBar, StatCard, etc.)
│   └── repo/       # Repository-specific components (RepoOverview)
├── constants/      # App constants and example repo list
├── hooks/          # TanStack Query hooks with built-in data transformation
├── layouts/        # Page layout shells (MainLayout)
├── pages/          # Route-level page components
├── router/         # React Router configuration with lazy loading
├── store/          # Zustand auth store (runtime state; no token persistence)
├── types/          # TypeScript interfaces for GitHub API responses
├── utils/          # Transformers, validators, dayjs config, ECharts theme
├── features/
│   └── rag/        # Ask Repo AI feature
│       ├── api/    # Frontend fetch wrappers for RAG endpoints
│       ├── components/  # AskRepoPanel, AnswerCard, SourceList, SuggestedQuestions
│       ├── hooks/  # useAskRepo, useAskHistory, useIngestStatus (TanStack Query)
│       └── types/  # Frontend RAG types
api/
├── auth/           # Vercel Serverless auth endpoints (start/callback/session/logout)
└── rag/            # RAG serverless endpoints
    ├── ask.ts      # POST — hybrid retrieval + conditional query rewrite + LLM answer generation
    ├── ingest.ts   # POST — fetch GitHub data, chunk, embed, store
    ├── resume.ts   # POST — resume interrupted SSE answer streams
    ├── share.ts    # POST — persist a generated answer as a share link
    └── status.ts   # GET  — check if a repo is indexed
lib/
└── rag/            # Shared server-side RAG library
    ├── chunking/   # Structure-aware chunkers (readme, issues, PRs, releases, commits)
    ├── embeddings/ # OpenAI embedding wrapper
    ├── github/     # GitHub data fetchers for ingestion (GraphQL snapshot + REST fallback)
    ├── auth/       # GitHub token verification & rate limiting
    ├── llm/        # Multi-provider LLM generation (OpenAI / DeepSeek / Groq / Gemini / Claude)
    ├── retrieval/  # Vector search, keyword search, hybrid merge, rerank, query router, conditional query rewrite, result merge
    ├── storage/    # Upstash Vector + Redis storage helpers (chunk counts, stream sessions, share links)
    └── types.ts    # Shared RAG type definitions
```

**Dashboard data flow:** Browser → `/api/github` proxy → GitHub API / GraphQL (server-side session token when available) → local ETag-backed cache → transformers → TanStack Query hooks → chart components
    - Repo overview + language distribution now share one GraphQL snapshot request (`getRepoSnapshot`) via a shared React Query key.
    - Top contributors are now aggregated from GraphQL commit history (with REST fallback), and monthly issue/PR counts are fetched via one GraphQL aliased search query.

**Ask Repo data flow:** Question → auth + rate limit → query router → hybrid retrieval (vector + keyword) → conditional query rewrite (analyze risk + confidence → optional multi-query fan-out) → merge + rerank → LLM → cited answer → optional share link saved in Redis

**Redis responsibilities:**
- daily ask / ingest rate limiting
- repository chunk-count cache for `/api/rag/status`
- SSE stream session state for `/api/rag/resume`
- share-link payload storage for `/api/rag/share/:id`

## SSE and Markdown Implementation Notes

### SSE streaming

- Stream endpoint: `POST /api/rag/ask` with `{ stream: true }`
- Resume endpoint: `POST /api/rag/resume` with `{ requestId, lastSeq }`
- Share endpoint: `POST /api/rag/share` to persist a finished answer and return `/share/:id`
- Server implementation: `api/rag/ask.ts`
    - Sets `text/event-stream` headers and disables proxy buffering
    - Sends `delta` events, then `sources`, then `[DONE]`
- Client implementation: `src/features/rag/api/rag.ts`
    - Uses `fetch` + `ReadableStream.getReader()`
    - Parses line-delimited `data: ...` events and dispatches to callbacks

### Markdown rendering

- Current answer renderer is custom (`src/features/rag/components/AnswerCard.tsx`), not `react-markdown`
- Supports:
    - fenced code blocks
    - bold (`**text**`)
    - inline code (`` `code` ``)
    - source tokens (`[Source N]`)
- Security hardening:
    - Source URLs are validated server-side before SSE/JSON response emission.
    - Markdown links/images are validated client-side against an allowlist before rendering as clickable/loaded content.

### Share links

- `POST /api/rag/share` stores `{ repo, question, answer, sources }` in Redis and returns a share URL
- `GET /share/:id` reads the entry back through `api/rag/share/[id].ts`
- Share entries currently expire after 7 days
- If Redis is not configured, share-link creation is unavailable

### Stream interruption handling

- ✅ **Phase 1 (2026-03-19)** — User-initiated cancellation & server-aware disconnect:
    - Client-side `AbortController` support; user can click "Stop" during streaming
    - Server listens for client disconnect (`req.on('close')`) and aborts LLM stream
    - Unified error event protocol; partial answers preserved on cancel
    - `useAskRepo` exports: `cancel()`, `retry()`, `streamStatus`, `streamError`
    - UI improvements: status indicators, stop/retry buttons, error boundary
- ✅ **Phase 2 (implemented) — Resume + observability improvements**:
    - Resume endpoint (`/api/rag/resume`) continues streams from Redis checkpoints
    - Heartbeat events are emitted to reduce proxy timeout risk
    - Request IDs and stream metrics are logged for tracing
    - Analytics-only deterministic SSE responses are excluded from resumable session persistence to prevent resume/LLM drift

## Deployment

This project is designed for **Vercel**:

1. Push the repository to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Set the environment variables (`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `AUTH_SESSION_SECRET`, `OPENAI_API_KEY`, `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and optionally `GITHUB_AUTH_CALLBACK_URL`, `LLM_PROVIDER`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RAG_DAILY_LIMIT`, `RAG_DAILY_INGEST_LIMIT`, `ADMIN_GITHUB_USERS`)
4. Deploy — the `api/` directory is automatically detected as Serverless Functions

### Ask Repo Architecture

```
┌─────────────────────────────────────┐
│  React Frontend                     │
│  AnalyzePage → AskRepoPanel         │
└──────────────┬──────────────────────┘
               │ fetch
               ▼
┌─────────────────────────────────────┐
│  Vercel Serverless Functions        │
│  /api/rag/ask     — answer question │
│     (SSE streaming + multi-LLM)     │
│  /api/rag/ingest  — index repo data │
│  /api/rag/resume  — resume streams  │
│  /api/rag/share   — save share link │
│  /api/rag/status  — check index     │
└──────┬──────────────────┬───────────┘
       │                  │
       ▼                  ▼
┌──────────────┐  ┌──────────────────┐
│  OpenAI API  │  │  Upstash Vector  │
│  embeddings  │  │  vector storage  │
│  + LLM       │  │  metadata filter │
│  (5 provid.) │  │                  │
└──────────────┘  └──────────────────┘
```

## License

MIT
