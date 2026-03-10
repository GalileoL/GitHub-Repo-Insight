# GitHub Repo Insight

A GitHub repository analytics dashboard that visualizes commit activity, language distribution, contributors, issues, pull requests, and releases with interactive charts and a professional dark UI.

Built as a frontend engineering showcase using modern React patterns.

![GitHub Repo Insight](https://img.shields.io/badge/status-live-brightgreen) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-blue)

## Screenshots

> *Screenshots coming soon — run `npm run dev` and explore any repository to see the dashboard in action.*

## Features

- **Repository Search** — Enter `owner/repo` or paste a GitHub URL to explore any public repository
- **Repository Overview** — Stars, forks, watchers, open issues, license, and metadata at a glance
- **Language Distribution** — Donut chart showing code breakdown by language
- **Top Contributors** — Horizontal bar chart of the most active contributors
- **Commit Trend** — Weekly commit activity over the past year as an area chart
- **Issues & PRs** — Monthly creation trend for issues and pull requests
- **Release Timeline** — Scrollable vertical timeline of the latest releases
- **Commit Heatmap** — GitHub-style calendar grid of daily commit activity
- **GitHub OAuth** — Optional sign-in to increase the API rate limit from 60 to 5,000 requests/hour
- **Recent History** — Locally stored search history for quick re-access
- **Dark Theme** — GitHub-inspired dark color palette throughout

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
| Deployment | Vercel (with Serverless Functions for OAuth) |

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

> **Note:** The app works without OAuth — you'll be limited to 60 GitHub API requests/hour as an anonymous user. To create an OAuth App, go to [GitHub Developer Settings](https://github.com/settings/developers).

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
└── utils/          # Transformers, validators, dayjs config, ECharts theme
api/
└── auth/           # Vercel Serverless Function for OAuth token exchange
```

**Data flow:** GitHub API → `githubFetch` client → transformers → TanStack Query hooks → presentation components

## Deployment

This project is designed for **Vercel**:

1. Push the repository to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Set the environment variables (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `VITE_GITHUB_CLIENT_ID`)
4. Deploy — the `api/` directory is automatically detected as Serverless Functions

## License

MIT
