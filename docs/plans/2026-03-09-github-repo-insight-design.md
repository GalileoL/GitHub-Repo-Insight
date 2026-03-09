# GitHub Repo Insight — Design Document

**Date:** 2026-03-09
**Status:** Approved

## Overview

A GitHub repository analytics dashboard where users input a repo (e.g. `facebook/react`) and view detailed charts and insights. Built as a frontend interview showcase demonstrating architecture, data visualization, and engineering quality.

## Tech Stack

- React 19 + TypeScript + Vite
- React Router (routing)
- TailwindCSS (styling, dark theme)
- TanStack Query (server state)
- Zustand (auth + UI state)
- ECharts (charts)
- dayjs (dates)
- zod (validation)
- Vercel Functions (OAuth token exchange)

## Architecture

```
Pages → Query Hooks (TanStack) → Transformers → API Client → GitHub REST API
                                                    ↑
                                              Zustand (auth token)
```

**Principles:**
- API client: single fetch wrapper, auto-attaches auth token, rate limit interceptor
- Transformers: pure functions converting API responses to chart-friendly formats
- Query hooks: TanStack Query wrappers composing API + transformers, 5min stale time
- Zustand: auth token, user info, rate limit state only — no server state
- Components: props-only, zero data fetching, zero business logic

## Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | HomePage | Search, examples, recent history |
| `/repo/:owner/:repo` | DashboardPage | All analytics sections |
| `/auth/callback` | AuthCallback | OAuth redirect handler |

## Dashboard Sections

1. **Repo Overview** — stat cards grid (stars, forks, watchers, issues, license, dates)
2. **Language Distribution** — donut chart
3. **Top Contributors** — bar chart + avatar list
4. **Commit Activity** — weekly trend line chart
5. **Issue/PR Trend** — area chart
6. **Release Timeline** — timeline component
7. **Commit Heatmap** — GitHub-style contribution grid (custom SVG)

Each section is lazy-loaded with Suspense + skeleton fallback.

## GitHub API Endpoints

| Data | Endpoint |
|------|----------|
| Repo details | `GET /repos/:owner/:repo` |
| Languages | `GET /repos/:owner/:repo/languages` |
| Contributors | `GET /repos/:owner/:repo/contributors` |
| Commit activity | `GET /repos/:owner/:repo/stats/commit_activity` |
| Releases | `GET /repos/:owner/:repo/releases` |
| Issues | `GET /repos/:owner/:repo/issues?state=all` |
| Pull requests | `GET /repos/:owner/:repo/pulls?state=all` |

**Rate limits:** Anonymous 60/hr, authenticated 5000/hr. Track via `X-RateLimit-Remaining` header. Warn at 20 remaining, prompt login on 403.

## Authentication

OAuth flow with Vercel serverless function for token exchange:

1. User clicks Login → redirect to GitHub OAuth authorize
2. GitHub redirects to `/auth/callback?code=XXX`
3. Frontend POSTs code to `/api/auth/github`
4. Vercel function exchanges code for token (client_secret server-side)
5. Token stored in Zustand + localStorage
6. Logout clears token + TanStack Query cache

## Visual Design

Dark dashboard theme:
- Background: `#0d1117`, Surface: `#161b22`, Border: `#30363d`
- Primary: `#58a6ff`, Success: `#3fb950`
- Text: `#f0f6fc` / `#8b949e`
- Gradient card backgrounds, glow hover effects, smooth 200-300ms transitions

## Folder Structure

```
src/
  api/           # GitHub client, types, endpoints
  components/
    common/      # SearchBar, StatCard, SectionCard, LoadingSkeleton, etc.
    charts/      # LanguagePieChart, ContributorBarChart, CommitHeatmap, etc.
    repo/        # Repo-specific composed components
  hooks/         # TanStack Query hooks, auth hooks
  pages/         # HomePage, DashboardPage, AuthCallback
  layouts/       # MainLayout with Navbar
  router/        # Route definitions
  store/         # Zustand stores (auth, ui)
  types/         # Shared TypeScript types
  utils/         # Transformers, helpers, validators
  constants/     # API URLs, theme tokens, example repos
api/             # Vercel serverless functions
```

## Agent Assignments

| Agent | Scope |
|-------|-------|
| Architect | Vite, TS config, folder scaffolding, routing, Tailwind |
| API Integration | GitHub client, Zod schemas, transformers, rate limit |
| State Management | Zustand auth store, TanStack Query config, all hooks |
| Frontend UI | Layout, Navbar, HomePage, common components |
| Visualization | 6 chart components, ECharts theme, CommitHeatmap |
| Auth | OAuth flow, Vercel function, callback page, login/logout |
| QA/Refactor | Review, memoization, lazy loading, final polish |

## Implementation Phases

1. Architecture + planning (this document)
2. Project setup + folder structure
3. API layer + GitHub client
4. Layout + routing
5. Home page
6. Repo dashboard base
7. Visualization components
8. Authentication system
9. Refactor + performance
10. README + documentation
