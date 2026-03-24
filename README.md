# GitHub Repo Insight

A GitHub repository analytics dashboard that visualizes commit activity, language distribution, contributors, issues, pull requests, and releases with interactive charts — plus an AI-powered "Ask Repo" feature for natural-language Q&A over any repository.

Built as a frontend engineering showcase using modern React patterns.

**Live:** [https://githubrepoinsight.xyz](https://githubrepoinsight.xyz)

![GitHub Repo Insight](https://img.shields.io/badge/status-live-brightgreen) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-blue)

## Screenshots

> *Screenshots coming soon — run `npm run dev` and explore any repository to see the dashboard in action.*
> ![dashboard_example](/image/image.png)
> ![AI_analuze_page](/image/image-1.png)

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
- **GitHub OAuth** — Optional sign-in to increase the API rate limit from 60 to 5,000 requests/hour
- **Ask Repo (AI)** — Ask natural-language questions about any indexed repository, powered by RAG
- **SSE Streaming** — LLM answers stream token-by-token with a live typing cursor
- **Multi-LLM Support** — Switch between OpenAI, DeepSeek, Groq, Gemini, and Claude via a single env var
- **On-Demand Indexing** — One-click ingestion of README, issues, PRs, releases, and commits into a vector database
- **Hybrid Retrieval** — Combines vector similarity + keyword search with query routing and reranking
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
| Deployment | Vercel (with Serverless Functions for OAuth + RAG API) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+ (or pnpm/yarn)

### Installation

```bash
git clone https://github.com/your-username/github-repo-insight.git
cd github-repo-insight
npm install
```

### Environment Variables

Copy the example env file and fill in your GitHub OAuth credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_GITHUB_CLIENT_ID` | GitHub OAuth App client ID (used in the browser) |
| `GITHUB_CLIENT_ID` | Same client ID (used by the serverless function) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret (server-side only) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings (always required for Ask Repo) |
| `UPSTASH_VECTOR_REST_URL` | Upstash Vector database REST endpoint |
| `UPSTASH_VECTOR_REST_TOKEN` | Upstash Vector authentication token |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (for rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis authentication token |
| `LLM_PROVIDER` | LLM provider: `openai` \| `deepseek` \| `groq` \| `gemini` \| `claude` (default: `openai`) |
| `DEEPSEEK_API_KEY` | DeepSeek API key (required when `LLM_PROVIDER=deepseek`) |
| `GROQ_API_KEY` | Groq API key (required when `LLM_PROVIDER=groq`) |
| `GEMINI_API_KEY` | Google Gemini API key (required when `LLM_PROVIDER=gemini`) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (required when `LLM_PROVIDER=claude`) |
| `RAG_DAILY_LIMIT` | Max questions per user per day (default: `20`) |
| `RAG_DAILY_INGEST_LIMIT` | Max index/re-index operations per user per day (default: `5`) |
| `ADMIN_GITHUB_USERS` | Comma-separated GitHub usernames with unlimited usage |

> **Note:** The dashboard works without OAuth (limited to 60 req/hr) and without AI keys (the Ask Repo feature will be unavailable). To create an OAuth App, go to [GitHub Developer Settings](https://github.com/settings/developers). For Upstash Vector, sign up at [upstash.com](https://upstash.com) and create a Vector index with 1536 dimensions. For Upstash Redis, create a Redis database at [upstash.com](https://upstash.com). Ask Repo requires GitHub login; regular users are limited to `RAG_DAILY_LIMIT` questions/day (default 20).

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
npm run preview
```

## Project Architecture

## AI Project Memory

For AI-assisted development and onboarding, see:

- `Memory.md` — concise architecture, API contracts, SSE/markdown behavior, and maintenance checklist

```
src/
├── api/            # GitHub API client with auth token injection & rate limiting
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
├── store/          # Zustand auth store with localStorage persistence
├── types/          # TypeScript interfaces for GitHub API responses
├── utils/          # Transformers, validators, dayjs config, ECharts theme
├── features/
│   └── rag/        # Ask Repo AI feature
│       ├── api/    # Frontend fetch wrappers for RAG endpoints
│       ├── components/  # AskRepoPanel, AnswerCard, SourceList, SuggestedQuestions
│       ├── hooks/  # useAskRepo, useAskHistory, useIngestStatus (TanStack Query)
│       └── types/  # Frontend RAG types
api/
├── auth/           # Vercel Serverless Function for OAuth token exchange
└── rag/            # RAG serverless endpoints
    ├── ask.ts      # POST — hybrid retrieval + LLM answer generation
    ├── ingest.ts   # POST — fetch GitHub data, chunk, embed, store
    └── status.ts   # GET  — check if a repo is indexed
lib/
└── rag/            # Shared server-side RAG library
    ├── chunking/   # Structure-aware chunkers (readme, issues, PRs, releases, commits)
    ├── embeddings/ # OpenAI embedding wrapper
    ├── github/     # GitHub data fetchers for ingestion
    ├── auth/       # GitHub token verification & rate limiting
    ├── llm/        # Multi-provider LLM generation (OpenAI / DeepSeek / Groq / Gemini / Claude)
    ├── retrieval/  # Vector search, keyword search, hybrid merge, rerank, query router
    ├── storage/    # Upstash Vector upsert / query / delete
    └── types.ts    # Shared RAG type definitions
```

**Dashboard data flow:** GitHub API → `githubFetch` client → transformers → TanStack Query hooks → chart components

**Ask Repo data flow:** Question → auth + rate limit → query router → hybrid retrieval (vector + keyword) → rerank → LLM → cited answer

## SSE and Markdown Implementation Notes

### SSE streaming

- Stream endpoint: `POST /api/rag/ask` with `{ stream: true }`
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

### Stream interruption handling

- ✅ **Phase 1 (2026-03-19)** — User-initiated cancellation & server-aware disconnect:
    - Client-side `AbortController` support; user can click "Stop" during streaming
    - Server listens for client disconnect (`req.on('close')`) and aborts LLM stream
    - Unified error event protocol; partial answers preserved on cancel
    - `useAskRepo` exports: `cancel()`, `retry()`, `streamStatus`, `streamError`
    - UI improvements: status indicators, stop/retry buttons, error boundary
- 🔄 **Phase 2 (planned)** — Reconnect protocol & observability:
    - Heartbeat events to prevent proxy timeout
    - Resume/partial-continue stream from last received position
    - Metrics: TTFB, stream duration, cancel rate, failure distribution

## Deployment

This project is designed for **Vercel**:

1. Push the repository to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Set the environment variables (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `VITE_GITHUB_CLIENT_ID`, `OPENAI_API_KEY`, `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and optionally `LLM_PROVIDER`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RAG_DAILY_LIMIT`, `RAG_DAILY_INGEST_LIMIT`, `ADMIN_GITHUB_USERS`)
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
