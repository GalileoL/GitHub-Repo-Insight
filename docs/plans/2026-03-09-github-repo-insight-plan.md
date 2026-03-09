# GitHub Repo Insight Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a GitHub repository analytics dashboard with charts, auth, and professional dark UI as a frontend interview showcase.

**Architecture:** Feature-sliced by technical layer. TanStack Query manages server state, Zustand manages auth/UI only. API client → transformers → hooks → presentation components. All chart components are lazy-loaded.

**Tech Stack:** React 19, TypeScript, Vite, React Router, TailwindCSS, TanStack Query, Zustand, ECharts, dayjs, zod, Vercel Functions

---

## Phase 2: Project Setup + Folder Structure

### Task 1: Initialize Vite + React + TypeScript Project

**Agent:** Architect

**Step 1: Scaffold project**

```bash
cd "/Users/galileo/Documents/code/projects/GitHub Repo Insight"
npm create vite@latest . -- --template react-ts
```

If prompted about non-empty directory, choose to proceed (only docs/ exists).

**Step 2: Install dependencies**

```bash
npm install react-router-dom @tanstack/react-query zustand echarts echarts-for-react dayjs zod
npm install -D tailwindcss @tailwindcss/vite prettier
```

**Step 3: Verify it builds**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Vite + React + TypeScript project with dependencies"
```

---

### Task 2: Configure Tailwind CSS with Dark Theme

**Agent:** Architect

**Files:**
- Modify: `src/index.css`
- Modify: `vite.config.ts`

**Step 1: Configure Vite with Tailwind plugin**

Replace `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
```

**Step 2: Set up Tailwind with dark theme tokens**

Replace `src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg-primary: #0d1117;
  --color-bg-surface: #161b22;
  --color-bg-elevated: #1c2128;
  --color-border-default: #30363d;
  --color-border-muted: #21262d;
  --color-accent-blue: #58a6ff;
  --color-accent-green: #3fb950;
  --color-accent-purple: #bc8cff;
  --color-accent-orange: #f0883e;
  --color-accent-red: #f85149;
  --color-accent-yellow: #d29922;
  --color-text-primary: #f0f6fc;
  --color-text-secondary: #8b949e;
  --color-text-muted: #6e7681;
}

body {
  @apply bg-bg-primary text-text-primary antialiased;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
}
```

**Step 3: Verify**

```bash
npm run dev
```

Open browser — should show dark background. Kill dev server.

**Step 4: Commit**

```bash
git add vite.config.ts src/index.css
git commit -m "chore: configure Tailwind CSS with dark theme tokens"
```

---

### Task 3: Create Folder Structure + Base Files

**Agent:** Architect

**Files to create:**
- `src/api/github.ts`
- `src/api/types.ts`
- `src/components/common/index.ts`
- `src/components/charts/index.ts`
- `src/components/repo/index.ts`
- `src/hooks/index.ts`
- `src/pages/HomePage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/AuthCallback.tsx`
- `src/layouts/MainLayout.tsx`
- `src/router/index.tsx`
- `src/store/auth.ts`
- `src/types/github.ts`
- `src/utils/transformers.ts`
- `src/utils/validators.ts`
- `src/constants/index.ts`

**Step 1: Create all directories and placeholder files**

Create each file with minimal content — just enough to be valid TypeScript/TSX. Examples:

`src/constants/index.ts`:
```ts
export const GITHUB_API_BASE = 'https://api.github.com';

export const EXAMPLE_REPOS = [
  { owner: 'facebook', repo: 'react', description: 'A JavaScript library for building user interfaces' },
  { owner: 'vercel', repo: 'next.js', description: 'The React Framework' },
  { owner: 'microsoft', repo: 'typescript', description: 'TypeScript is a superset of JavaScript' },
  { owner: 'tailwindlabs', repo: 'tailwindcss', description: 'A utility-first CSS framework' },
  { owner: 'denoland', repo: 'deno', description: 'A modern runtime for JavaScript and TypeScript' },
] as const;

export const RATE_LIMIT_WARNING_THRESHOLD = 20;
```

`src/types/github.ts`:
```ts
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  license: { name: string; spdx_id: string } | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
  default_branch: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubContributor {
  login: string;
  avatar_url: string;
  contributions: number;
  html_url: string;
}

export interface GitHubLanguages {
  [language: string]: number;
}

export interface GitHubCommitActivity {
  days: number[];
  total: number;
  week: number;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  body: string | null;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  created_at: string;
  closed_at: string | null;
  pull_request?: { url: string };
  labels: Array<{ name: string; color: string }>;
}

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}
```

All other files get minimal placeholder exports (e.g., `export {};` or a stub component).

**Step 2: Update App.tsx to use router**

`src/App.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

`src/router/index.tsx`:
```tsx
import { createBrowserRouter } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';

const HomePage = lazy(() => import('../pages/HomePage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AuthCallback = lazy(() => import('../pages/AuthCallback'));

import { lazy, Suspense } from 'react';

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      {
        path: '/',
        element: <SuspenseWrapper><HomePage /></SuspenseWrapper>,
      },
      {
        path: '/repo/:owner/:repo',
        element: <SuspenseWrapper><DashboardPage /></SuspenseWrapper>,
      },
      {
        path: '/auth/callback',
        element: <SuspenseWrapper><AuthCallback /></SuspenseWrapper>,
      },
    ],
  },
]);
```

`src/layouts/MainLayout.tsx`:
```tsx
import { Outlet } from 'react-router-dom';

export default function MainLayout() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <nav className="border-b border-border-default bg-bg-surface">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <a href="/" className="text-lg font-semibold text-text-primary">GitHub Repo Insight</a>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

Stub pages (`src/pages/HomePage.tsx`, etc.):
```tsx
export default function HomePage() {
  return <div className="p-8">Home Page</div>;
}
```

**Step 3: Clean up default Vite files**

Remove `src/App.css`, update `src/main.tsx` to remove StrictMode wrapping of old App:

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 4: Verify build**

```bash
npm run build
```

Expected: Clean build, no errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: create folder structure, routing, and base files"
```

---

## Phase 3: API Layer + GitHub Client

### Task 4: Build GitHub API Client

**Agent:** API Integration

**Files:**
- Create: `src/api/github.ts`
- Modify: `src/store/auth.ts` (need token getter)

**Step 1: Create auth store first (minimal)**

`src/store/auth.ts`:
```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  user: { login: string; avatar_url: string } | null;
  setAuth: (token: string, user: { login: string; avatar_url: string }) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
      isAuthenticated: () => get().token !== null,
    }),
    { name: 'github-auth' },
  ),
);
```

**Step 2: Build the GitHub API client**

`src/api/github.ts`:
```ts
import { useAuthStore } from '../store/auth';
import { GITHUB_API_BASE } from '../constants';
import type { RateLimit } from '../types/github';

interface GitHubClientOptions {
  token?: string | null;
}

let latestRateLimit: RateLimit | null = null;

export function getRateLimit(): RateLimit | null {
  return latestRateLimit;
}

function updateRateLimit(headers: Headers): void {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const used = headers.get('x-ratelimit-used');

  if (limit && remaining && reset && used) {
    latestRateLimit = {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      reset: parseInt(reset, 10),
      used: parseInt(used, 10),
    };
  }
}

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public isRateLimit: boolean = false,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export async function githubFetch<T>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, string> },
): Promise<T> {
  const token = useAuthStore.getState().token;
  const url = new URL(`${GITHUB_API_BASE}${endpoint}`);

  if (options?.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(url.toString(), {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  updateRateLimit(response.headers);

  if (!response.ok) {
    const isRateLimit = response.status === 403 || response.status === 429;
    const body = await response.json().catch(() => ({}));
    throw new GitHubApiError(
      response.status,
      body.message || `GitHub API error: ${response.status}`,
      isRateLimit,
    );
  }

  return response.json();
}

// API endpoint functions
export const githubApi = {
  getRepo: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubRepo>(`/repos/${owner}/${repo}`),

  getLanguages: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubLanguages>(`/repos/${owner}/${repo}/languages`),

  getContributors: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubContributor[]>(`/repos/${owner}/${repo}/contributors`, {
      params: { per_page: '30' },
    }),

  getCommitActivity: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubCommitActivity[]>(`/repos/${owner}/${repo}/stats/commit_activity`),

  getReleases: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubRelease[]>(`/repos/${owner}/${repo}/releases`, {
      params: { per_page: '20' },
    }),

  getIssues: (owner: string, repo: string, params?: Record<string, string>) =>
    githubFetch<import('../types/github').GitHubIssue[]>(`/repos/${owner}/${repo}/issues`, {
      params: { state: 'all', per_page: '100', sort: 'created', direction: 'desc', ...params },
    }),
};
```

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/api/github.ts src/store/auth.ts
git commit -m "feat: add GitHub API client with auth token injection and rate limit tracking"
```

---

### Task 5: Create Data Transformers

**Agent:** API Integration

**Files:**
- Create: `src/utils/transformers.ts`

**Step 1: Write transformers**

`src/utils/transformers.ts`:
```ts
import dayjs from 'dayjs';
import type {
  GitHubLanguages,
  GitHubContributor,
  GitHubCommitActivity,
  GitHubIssue,
  GitHubRelease,
} from '../types/github';

// Chart data types
export interface LanguageChartData {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

export interface ContributorChartData {
  login: string;
  avatar_url: string;
  contributions: number;
}

export interface CommitTrendData {
  week: string;
  commits: number;
}

export interface IssuePrTrendData {
  date: string;
  issues: number;
  pullRequests: number;
}

export interface ReleaseTimelineData {
  tag: string;
  name: string;
  date: string;
  url: string;
  prerelease: boolean;
}

export interface HeatmapData {
  date: string;
  count: number;
}

const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  PHP: '#4F5D95',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#239120',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Scala: '#c22d40',
  Vue: '#41b883',
  Svelte: '#ff3e00',
};

function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language] || '#8b949e';
}

export function transformLanguages(data: GitHubLanguages): LanguageChartData[] {
  const total = Object.values(data).reduce((sum, bytes) => sum + bytes, 0);
  if (total === 0) return [];

  return Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .map(([name, bytes]) => ({
      name,
      value: bytes,
      percentage: Math.round((bytes / total) * 1000) / 10,
      color: getLanguageColor(name),
    }));
}

export function transformContributors(data: GitHubContributor[]): ContributorChartData[] {
  return data.slice(0, 20).map(({ login, avatar_url, contributions }) => ({
    login,
    avatar_url,
    contributions,
  }));
}

export function transformCommitActivity(data: GitHubCommitActivity[]): CommitTrendData[] {
  return data.map((week) => ({
    week: dayjs.unix(week.week).format('MMM DD'),
    commits: week.total,
  }));
}

export function transformIssuesAndPrs(issues: GitHubIssue[]): IssuePrTrendData[] {
  const grouped: Record<string, { issues: number; pullRequests: number }> = {};

  issues.forEach((issue) => {
    const month = dayjs(issue.created_at).format('YYYY-MM');
    if (!grouped[month]) grouped[month] = { issues: 0, pullRequests: 0 };
    if (issue.pull_request) {
      grouped[month].pullRequests++;
    } else {
      grouped[month].issues++;
    }
  });

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date: dayjs(date).format('MMM YYYY'),
      ...counts,
    }));
}

export function transformReleases(data: GitHubRelease[]): ReleaseTimelineData[] {
  return data
    .filter((r) => r.published_at)
    .sort((a, b) => dayjs(b.published_at).unix() - dayjs(a.published_at).unix())
    .map((release) => ({
      tag: release.tag_name,
      name: release.name || release.tag_name,
      date: dayjs(release.published_at).format('MMM DD, YYYY'),
      url: release.html_url,
      prerelease: release.prerelease,
    }));
}

export function transformCommitHeatmap(data: GitHubCommitActivity[]): HeatmapData[] {
  const result: HeatmapData[] = [];

  data.forEach((week) => {
    const startDate = dayjs.unix(week.week);
    week.days.forEach((count, dayIndex) => {
      result.push({
        date: startDate.add(dayIndex, 'day').format('YYYY-MM-DD'),
        count,
      });
    });
  });

  return result;
}
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/utils/transformers.ts
git commit -m "feat: add data transformers for all chart types"
```

---

### Task 6: Create TanStack Query Hooks

**Agent:** State Management

**Files:**
- Create: `src/hooks/useRepo.ts`
- Create: `src/hooks/useContributors.ts`
- Create: `src/hooks/useLanguages.ts`
- Create: `src/hooks/useCommitActivity.ts`
- Create: `src/hooks/useReleases.ts`
- Create: `src/hooks/useIssues.ts`
- Create: `src/hooks/index.ts`

**Step 1: Create all hooks**

`src/hooks/useRepo.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';

export function useRepo(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repo', owner, repo],
    queryFn: () => githubApi.getRepo(owner, repo),
    enabled: !!owner && !!repo,
  });
}
```

`src/hooks/useLanguages.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformLanguages } from '../utils/transformers';

export function useLanguages(owner: string, repo: string) {
  return useQuery({
    queryKey: ['languages', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getLanguages(owner, repo);
      return transformLanguages(data);
    },
    enabled: !!owner && !!repo,
  });
}
```

`src/hooks/useContributors.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformContributors } from '../utils/transformers';

export function useContributors(owner: string, repo: string) {
  return useQuery({
    queryKey: ['contributors', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getContributors(owner, repo);
      return transformContributors(data);
    },
    enabled: !!owner && !!repo,
  });
}
```

`src/hooks/useCommitActivity.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformCommitActivity, transformCommitHeatmap } from '../utils/transformers';

export function useCommitActivity(owner: string, repo: string) {
  return useQuery({
    queryKey: ['commitActivity', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getCommitActivity(owner, repo);
      return {
        trend: transformCommitActivity(data),
        heatmap: transformCommitHeatmap(data),
      };
    },
    enabled: !!owner && !!repo,
  });
}
```

`src/hooks/useReleases.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformReleases } from '../utils/transformers';

export function useReleases(owner: string, repo: string) {
  return useQuery({
    queryKey: ['releases', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getReleases(owner, repo);
      return transformReleases(data);
    },
    enabled: !!owner && !!repo,
  });
}
```

`src/hooks/useIssues.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformIssuesAndPrs } from '../utils/transformers';

export function useIssues(owner: string, repo: string) {
  return useQuery({
    queryKey: ['issues', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getIssues(owner, repo);
      return transformIssuesAndPrs(data);
    },
    enabled: !!owner && !!repo,
  });
}
```

`src/hooks/index.ts`:
```ts
export { useRepo } from './useRepo';
export { useLanguages } from './useLanguages';
export { useContributors } from './useContributors';
export { useCommitActivity } from './useCommitActivity';
export { useReleases } from './useReleases';
export { useIssues } from './useIssues';
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/hooks/
git commit -m "feat: add TanStack Query hooks for all GitHub data endpoints"
```

---

## Phase 4: Layout + Routing

### Task 7: Build Navbar Component

**Agent:** Frontend UI

**Files:**
- Create: `src/components/common/Navbar.tsx`
- Modify: `src/layouts/MainLayout.tsx`

**Step 1: Create Navbar**

`src/components/common/Navbar.tsx`:
```tsx
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';

export function Navbar() {
  const { user, token, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAuthenticated = !!token;

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border-default bg-bg-surface/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-text-primary group-hover:text-accent-blue transition-colors">
              Repo Insight
            </span>
          </Link>

          {/* Auth Section */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <div className="flex items-center gap-2 rounded-full bg-accent-green/10 px-3 py-1.5 border border-accent-green/20">
                  <div className="h-2 w-2 rounded-full bg-accent-green animate-pulse" />
                  <span className="text-sm text-accent-green">Authenticated</span>
                </div>
                <img
                  src={user?.avatar_url}
                  alt={user?.login}
                  className="h-8 w-8 rounded-full ring-2 ring-border-default"
                />
                <button
                  onClick={handleLogout}
                  className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-full bg-accent-yellow/10 px-3 py-1.5 border border-accent-yellow/20">
                  <div className="h-2 w-2 rounded-full bg-accent-yellow" />
                  <span className="text-sm text-accent-yellow">Anonymous</span>
                </div>
                <a
                  href={`https://github.com/login/oauth/authorize?client_id=${import.meta.env.VITE_GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}&scope=read:user`}
                  className="rounded-lg bg-accent-blue/10 border border-accent-blue/20 px-4 py-1.5 text-sm font-medium text-accent-blue hover:bg-accent-blue/20 transition-colors"
                >
                  Sign in with GitHub
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
```

**Step 2: Update MainLayout**

`src/layouts/MainLayout.tsx`:
```tsx
import { Outlet } from 'react-router-dom';
import { Navbar } from '../components/common/Navbar';

export default function MainLayout() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/components/common/Navbar.tsx src/layouts/MainLayout.tsx
git commit -m "feat: add Navbar with auth status and responsive layout"
```

---

### Task 8: Build Common UI Components

**Agent:** Frontend UI

**Files:**
- Create: `src/components/common/SearchBar.tsx`
- Create: `src/components/common/StatCard.tsx`
- Create: `src/components/common/SectionCard.tsx`
- Create: `src/components/common/ChartContainer.tsx`
- Create: `src/components/common/LoadingSkeleton.tsx`
- Create: `src/components/common/EmptyState.tsx`
- Create: `src/components/common/ErrorState.tsx`
- Create: `src/components/common/index.ts`

**Step 1: Create SearchBar**

`src/components/common/SearchBar.tsx`:
```tsx
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

const repoInputSchema = z.union([
  z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/),
  z.string().url().transform((url) => {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    return match ? `${match[1]}/${match[2]}` : '';
  }),
]);

interface SearchBarProps {
  size?: 'default' | 'large';
  placeholder?: string;
}

export function SearchBar({ size = 'default', placeholder = 'Search repository (e.g. facebook/react)' }: SearchBarProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      const trimmed = input.trim().replace(/\/$/, '');
      const result = repoInputSchema.safeParse(trimmed);

      if (!result.success) {
        setError('Enter a valid owner/repo or GitHub URL');
        return;
      }

      const parsed = result.data;
      const [owner, repo] = parsed.includes('/') ? parsed.split('/') : ['', ''];

      if (!owner || !repo) {
        setError('Enter a valid owner/repo or GitHub URL');
        return;
      }

      // Save to recent history
      const history = JSON.parse(localStorage.getItem('repo-history') || '[]') as string[];
      const updated = [parsed, ...history.filter((h) => h !== parsed)].slice(0, 10);
      localStorage.setItem('repo-history', JSON.stringify(updated));

      navigate(`/repo/${owner}/${repo}`);
    },
    [input, navigate],
  );

  const isLarge = size === 'large';

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative group">
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-accent-blue/20 to-accent-purple/20 blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <div className="relative flex items-center">
          <svg
            className={`absolute left-4 text-text-muted ${isLarge ? 'h-6 w-6' : 'h-5 w-5'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(''); }}
            placeholder={placeholder}
            className={`w-full rounded-xl border border-border-default bg-bg-surface text-text-primary placeholder:text-text-muted
              focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/50 focus:outline-none transition-all
              ${isLarge ? 'py-4 pl-14 pr-32 text-lg' : 'py-3 pl-12 pr-28 text-sm'}`}
          />
          <button
            type="submit"
            className={`absolute right-2 rounded-lg bg-accent-blue font-medium text-white
              hover:bg-accent-blue/90 active:scale-95 transition-all
              ${isLarge ? 'px-6 py-2.5 text-base' : 'px-4 py-2 text-sm'}`}
          >
            Explore
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
    </form>
  );
}
```

**Step 2: Create StatCard**

`src/components/common/StatCard.tsx`:
```tsx
import { memo } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
}

export const StatCard = memo(function StatCard({ label, value, icon, trend }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-5 transition-all hover:border-border-muted hover:shadow-lg hover:shadow-accent-blue/5">
      <div className="absolute inset-0 bg-gradient-to-br from-accent-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">{label}</span>
          <div className="text-text-muted">{icon}</div>
        </div>
        <p className="mt-2 text-2xl font-bold text-text-primary">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {trend && (
          <p className={`mt-1 text-xs ${trend.value >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
          </p>
        )}
      </div>
    </div>
  );
});
```

**Step 3: Create SectionCard**

`src/components/common/SectionCard.tsx`:
```tsx
interface SectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SectionCard({ title, description, children, className = '' }: SectionCardProps) {
  return (
    <div className={`rounded-xl border border-border-default bg-bg-surface overflow-hidden ${className}`}>
      <div className="border-b border-border-default px-6 py-4">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
```

**Step 4: Create ChartContainer**

`src/components/common/ChartContainer.tsx`:
```tsx
import { LoadingSkeleton } from './LoadingSkeleton';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';

interface ChartContainerProps {
  loading: boolean;
  error: Error | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  height?: string;
  children: React.ReactNode;
}

export function ChartContainer({ loading, error, isEmpty, emptyMessage, height = 'h-80', children }: ChartContainerProps) {
  if (loading) return <LoadingSkeleton className={height} />;
  if (error) return <ErrorState message={error.message} />;
  if (isEmpty) return <EmptyState message={emptyMessage || 'No data available'} />;
  return <div className={height}>{children}</div>;
}
```

**Step 5: Create LoadingSkeleton, EmptyState, ErrorState**

`src/components/common/LoadingSkeleton.tsx`:
```tsx
interface LoadingSkeletonProps {
  className?: string;
  variant?: 'chart' | 'card' | 'text';
}

export function LoadingSkeleton({ className = 'h-80', variant = 'chart' }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default p-5 ${className}`}>
        <div className="h-4 w-24 rounded bg-bg-elevated mb-3" />
        <div className="h-8 w-16 rounded bg-bg-elevated" />
      </div>
    );
  }

  if (variant === 'text') {
    return (
      <div className={`animate-pulse space-y-2 ${className}`}>
        <div className="h-4 w-3/4 rounded bg-bg-elevated" />
        <div className="h-4 w-1/2 rounded bg-bg-elevated" />
      </div>
    );
  }

  return (
    <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default flex items-center justify-center ${className}`}>
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin" />
        <span className="text-sm text-text-muted">Loading...</span>
      </div>
    </div>
  );
}
```

`src/components/common/EmptyState.tsx`:
```tsx
interface EmptyStateProps {
  message: string;
  icon?: React.ReactNode;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon || (
        <svg className="h-12 w-12 text-text-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      )}
      <p className="text-text-secondary">{message}</p>
    </div>
  );
}
```

`src/components/common/ErrorState.tsx`:
```tsx
import { useAuthStore } from '../../store/auth';

interface ErrorStateProps {
  message: string;
  isRateLimit?: boolean;
  onRetry?: () => void;
}

export function ErrorState({ message, isRateLimit, onRetry }: ErrorStateProps) {
  const isAuthenticated = !!useAuthStore((s) => s.token);

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="h-12 w-12 rounded-full bg-accent-red/10 flex items-center justify-center mb-3">
        <svg className="h-6 w-6 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-text-secondary mb-4">{message}</p>
      {isRateLimit && !isAuthenticated && (
        <p className="text-sm text-accent-yellow mb-4">
          Sign in with GitHub to increase your API rate limit (60 → 5,000 requests/hour)
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-primary hover:bg-bg-elevated transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
```

**Step 6: Create barrel export**

`src/components/common/index.ts`:
```ts
export { Navbar } from './Navbar';
export { SearchBar } from './SearchBar';
export { StatCard } from './StatCard';
export { SectionCard } from './SectionCard';
export { ChartContainer } from './ChartContainer';
export { LoadingSkeleton } from './LoadingSkeleton';
export { EmptyState } from './EmptyState';
export { ErrorState } from './ErrorState';
```

**Step 7: Verify build**

```bash
npm run build
```

**Step 8: Commit**

```bash
git add src/components/common/
git commit -m "feat: add common UI components (SearchBar, StatCard, SectionCard, ChartContainer, skeletons, states)"
```

---

## Phase 5: Home Page

### Task 9: Build Home Page

**Agent:** Frontend UI

**Files:**
- Create: `src/pages/HomePage.tsx`

**Step 1: Implement HomePage**

`src/pages/HomePage.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../components/common/SearchBar';
import { EXAMPLE_REPOS } from '../constants';

export default function HomePage() {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('repo-history') || '[]');
    setHistory(stored);
  }, []);

  const clearHistory = () => {
    localStorage.removeItem('repo-history');
    setHistory([]);
  };

  return (
    <div className="flex flex-col items-center px-4 pt-20 pb-16">
      {/* Hero */}
      <div className="relative mb-12 text-center">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-accent-blue/10 blur-3xl" />
        <div className="relative">
          <h1 className="text-5xl font-bold tracking-tight text-text-primary sm:text-6xl">
            GitHub Repo{' '}
            <span className="bg-gradient-to-r from-accent-blue to-accent-purple bg-clip-text text-transparent">
              Insight
            </span>
          </h1>
          <p className="mt-4 text-lg text-text-secondary max-w-xl mx-auto">
            Explore any GitHub repository with detailed analytics, charts, and insights.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="w-full max-w-2xl mb-16">
        <SearchBar size="large" />
      </div>

      {/* Example Repos */}
      <div className="w-full max-w-4xl mb-12">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">Popular Repositories</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {EXAMPLE_REPOS.map(({ owner, repo, description }) => (
            <Link
              key={`${owner}/${repo}`}
              to={`/repo/${owner}/${repo}`}
              className="group rounded-xl border border-border-default bg-bg-surface p-4 hover:border-accent-blue/30 hover:shadow-lg hover:shadow-accent-blue/5 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-6 w-6 rounded-full bg-bg-elevated flex items-center justify-center">
                  <svg className="h-3.5 w-3.5 text-text-muted" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-accent-blue group-hover:underline">
                  {owner}/{repo}
                </span>
              </div>
              <p className="text-xs text-text-secondary line-clamp-2">{description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent History */}
      {history.length > 0 && (
        <div className="w-full max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">Recent Searches</h2>
            <button
              onClick={clearHistory}
              className="text-xs text-text-muted hover:text-accent-red transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((item) => (
              <Link
                key={item}
                to={`/repo/${item}`}
                className="rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-sm text-text-secondary hover:text-accent-blue hover:border-accent-blue/30 transition-colors"
              >
                {item}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/pages/HomePage.tsx
git commit -m "feat: build Home page with search, example repos, and recent history"
```

---

## Phase 6: Repo Dashboard Base

### Task 10: Build Dashboard Page + Repo Overview Section

**Agent:** Frontend UI

**Files:**
- Create: `src/pages/DashboardPage.tsx`
- Create: `src/components/repo/RepoOverview.tsx`
- Create: `src/components/repo/index.ts`

**Step 1: Create RepoOverview**

`src/components/repo/RepoOverview.tsx`:
```tsx
import { memo } from 'react';
import dayjs from 'dayjs';
import { StatCard } from '../common/StatCard';
import type { GitHubRepo } from '../../types/github';

interface RepoOverviewProps {
  repo: GitHubRepo;
}

export const RepoOverview = memo(function RepoOverview({ repo }: RepoOverviewProps) {
  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <img src={repo.owner.avatar_url} alt={repo.owner.login} className="h-10 w-10 rounded-full ring-2 ring-border-default" />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{repo.full_name}</h1>
            {repo.description && <p className="text-text-secondary mt-1">{repo.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-muted mt-3">
          {repo.language && (
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-accent-blue" />
              {repo.language}
            </span>
          )}
          {repo.license && <span>{repo.license.spdx_id}</span>}
          <span>Created {dayjs(repo.created_at).format('MMM DD, YYYY')}</span>
          <span>Updated {dayjs(repo.updated_at).fromNow()}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Stars"
          value={repo.stargazers_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>}
        />
        <StatCard
          label="Forks"
          value={repo.forks_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" /></svg>}
        />
        <StatCard
          label="Watchers"
          value={repo.watchers_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <StatCard
          label="Open Issues"
          value={repo.open_issues_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>}
        />
        <StatCard
          label="Default Branch"
          value={repo.default_branch}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>}
        />
      </div>
    </div>
  );
});
```

**Step 2: Create DashboardPage**

`src/pages/DashboardPage.tsx`:
```tsx
import { useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useRepo, useLanguages, useContributors, useCommitActivity, useReleases, useIssues } from '../hooks';
import { RepoOverview } from '../components/repo/RepoOverview';
import { SectionCard, LoadingSkeleton, ErrorState } from '../components/common';

const LanguagePieChart = lazy(() => import('../components/charts/LanguagePieChart'));
const ContributorBarChart = lazy(() => import('../components/charts/ContributorBarChart'));
const CommitTrendChart = lazy(() => import('../components/charts/CommitTrendChart'));
const IssuePrTrendChart = lazy(() => import('../components/charts/IssuePrTrendChart'));
const ReleaseTimeline = lazy(() => import('../components/charts/ReleaseTimeline'));
const CommitHeatmap = lazy(() => import('../components/charts/CommitHeatmap'));

function ChartSkeleton() {
  return <LoadingSkeleton className="h-80" />;
}

export default function DashboardPage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();
  const repoQuery = useRepo(owner, repo);
  const languagesQuery = useLanguages(owner, repo);
  const contributorsQuery = useContributors(owner, repo);
  const commitActivityQuery = useCommitActivity(owner, repo);
  const releasesQuery = useReleases(owner, repo);
  const issuesQuery = useIssues(owner, repo);

  if (repoQuery.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <LoadingSkeleton className="h-48" />
        <div className="grid grid-cols-2 gap-4">
          <LoadingSkeleton className="h-80" />
          <LoadingSkeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (repoQuery.error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <ErrorState
          message={repoQuery.error.message}
          isRateLimit={repoQuery.error instanceof Error && 'isRateLimit' in repoQuery.error}
          onRetry={() => repoQuery.refetch()}
        />
      </div>
    );
  }

  if (!repoQuery.data) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Repo Overview */}
      <RepoOverview repo={repoQuery.data} />

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Language Distribution */}
        <SectionCard title="Language Distribution" description="Breakdown by bytes of code">
          <Suspense fallback={<ChartSkeleton />}>
            <LanguagePieChart
              data={languagesQuery.data}
              loading={languagesQuery.isLoading}
              error={languagesQuery.error}
            />
          </Suspense>
        </SectionCard>

        {/* Top Contributors */}
        <SectionCard title="Top Contributors" description="By number of commits">
          <Suspense fallback={<ChartSkeleton />}>
            <ContributorBarChart
              data={contributorsQuery.data}
              loading={contributorsQuery.isLoading}
              error={contributorsQuery.error}
            />
          </Suspense>
        </SectionCard>
      </div>

      {/* Commit Activity */}
      <SectionCard title="Commit Activity" description="Weekly commit trend over the past year">
        <Suspense fallback={<ChartSkeleton />}>
          <CommitTrendChart
            data={commitActivityQuery.data?.trend}
            loading={commitActivityQuery.isLoading}
            error={commitActivityQuery.error}
          />
        </Suspense>
      </SectionCard>

      {/* Issue / PR Trend */}
      <SectionCard title="Issues & Pull Requests" description="Monthly creation trend">
        <Suspense fallback={<ChartSkeleton />}>
          <IssuePrTrendChart
            data={issuesQuery.data}
            loading={issuesQuery.isLoading}
            error={issuesQuery.error}
          />
        </Suspense>
      </SectionCard>

      {/* Release Timeline */}
      <SectionCard title="Releases" description="Recent release history">
        <Suspense fallback={<ChartSkeleton />}>
          <ReleaseTimeline
            data={releasesQuery.data}
            loading={releasesQuery.isLoading}
            error={releasesQuery.error}
          />
        </Suspense>
      </SectionCard>

      {/* Commit Heatmap */}
      <SectionCard title="Commit Heatmap" description="Daily commit activity">
        <Suspense fallback={<ChartSkeleton />}>
          <CommitHeatmap
            data={commitActivityQuery.data?.heatmap}
            loading={commitActivityQuery.isLoading}
            error={commitActivityQuery.error}
          />
        </Suspense>
      </SectionCard>
    </div>
  );
}
```

`src/components/repo/index.ts`:
```ts
export { RepoOverview } from './RepoOverview';
```

**Step 3: Verify build (will fail on missing chart components — expected, they're lazy loaded)**

```bash
npm run build
```

Note: Build might warn about missing chart modules. That's fine — they'll be created in Phase 7.

**Step 4: Commit**

```bash
git add src/pages/DashboardPage.tsx src/components/repo/
git commit -m "feat: build Dashboard page with repo overview and chart section layout"
```

---

## Phase 7: Visualization Components

### Task 11: Create ECharts Theme + Base Chart Hook

**Agent:** Visualization

**Files:**
- Create: `src/utils/echarts-theme.ts`
- Create: `src/hooks/useECharts.ts`

**Step 1: Create shared ECharts dark theme**

`src/utils/echarts-theme.ts`:
```ts
import type { EChartsOption } from 'echarts';

export const darkTheme: EChartsOption = {
  backgroundColor: 'transparent',
  textStyle: {
    color: '#8b949e',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  },
  title: {
    textStyle: { color: '#f0f6fc' },
  },
  legend: {
    textStyle: { color: '#8b949e' },
  },
  tooltip: {
    backgroundColor: '#1c2128',
    borderColor: '#30363d',
    textStyle: { color: '#f0f6fc', fontSize: 13 },
  },
  xAxis: {
    axisLine: { lineStyle: { color: '#30363d' } },
    axisTick: { lineStyle: { color: '#30363d' } },
    axisLabel: { color: '#8b949e' },
    splitLine: { lineStyle: { color: '#21262d' } },
  },
  yAxis: {
    axisLine: { lineStyle: { color: '#30363d' } },
    axisTick: { lineStyle: { color: '#30363d' } },
    axisLabel: { color: '#8b949e' },
    splitLine: { lineStyle: { color: '#21262d' } },
  },
};
```

**Step 2: Create useECharts hook**

`src/hooks/useECharts.ts`:
```ts
import { useRef, useEffect, useCallback } from 'react';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart, BarChart, LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components';
import type { EChartsOption } from 'echarts';

echarts.use([
  CanvasRenderer,
  PieChart,
  BarChart,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
]);

export function useECharts(option: EChartsOption | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const initChart = useCallback(() => {
    if (!containerRef.current) return;
    if (chartRef.current) {
      chartRef.current.dispose();
    }
    chartRef.current = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
  }, []);

  useEffect(() => {
    initChart();

    const observer = new ResizeObserver(() => {
      chartRef.current?.resize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [initChart]);

  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(option, true);
    }
  }, [option]);

  return containerRef;
}
```

**Step 3: Commit**

```bash
git add src/utils/echarts-theme.ts src/hooks/useECharts.ts
git commit -m "feat: add ECharts dark theme and reusable useECharts hook"
```

---

### Task 12: Build LanguagePieChart

**Agent:** Visualization

**Files:**
- Create: `src/components/charts/LanguagePieChart.tsx`

**Step 1: Implement**

`src/components/charts/LanguagePieChart.tsx`:
```tsx
import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { LanguageChartData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface LanguagePieChartProps {
  data: LanguageChartData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function LanguagePieChart({ data, loading, error }: LanguagePieChartProps) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
        formatter: (params: any) => `${params.name}: ${params.data.percentage}%`,
      },
      legend: {
        orient: 'vertical',
        right: 10,
        top: 'center',
        textStyle: { color: '#8b949e' },
      },
      series: [
        {
          type: 'pie',
          radius: ['45%', '75%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#161b22',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 14, fontWeight: 'bold', color: '#f0f6fc' },
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(88, 166, 255, 0.3)' },
          },
          data: data.map((item) => ({
            name: item.name,
            value: item.value,
            percentage: item.percentage,
            itemStyle: { color: item.color },
          })),
        },
      ],
    };
  }, [data]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No language data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/charts/LanguagePieChart.tsx
git commit -m "feat: add LanguagePieChart donut chart component"
```

---

### Task 13: Build ContributorBarChart

**Agent:** Visualization

**Files:**
- Create: `src/components/charts/ContributorBarChart.tsx`

**Step 1: Implement**

`src/components/charts/ContributorBarChart.tsx`:
```tsx
import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { ContributorChartData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface ContributorBarChartProps {
  data: ContributorChartData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function ContributorBarChart({ data, loading, error }: ContributorBarChartProps) {
  const topContributors = useMemo(() => data?.slice(0, 10), [data]);

  const option = useMemo<EChartsOption | null>(() => {
    if (!topContributors) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
        axisPointer: { type: 'shadow' },
      },
      grid: { left: 100, right: 30, top: 10, bottom: 30 },
      xAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      yAxis: {
        type: 'category',
        data: topContributors.map((c) => c.login).reverse(),
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', fontSize: 12 },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: topContributors.map((c) => c.contributions).reverse(),
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: '#58a6ff' },
                { offset: 1, color: '#bc8cff' },
              ],
            },
          },
          barWidth: '60%',
        },
      ],
    };
  }, [topContributors]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No contributor data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/charts/ContributorBarChart.tsx
git commit -m "feat: add ContributorBarChart with gradient bars"
```

---

### Task 14: Build CommitTrendChart

**Agent:** Visualization

**Files:**
- Create: `src/components/charts/CommitTrendChart.tsx`

**Step 1: Implement**

`src/components/charts/CommitTrendChart.tsx`:
```tsx
import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { CommitTrendData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface CommitTrendChartProps {
  data: CommitTrendData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function CommitTrendChart({ data, loading, error }: CommitTrendChartProps) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
      },
      grid: { left: 50, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.week),
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', rotate: 45, fontSize: 11 },
        axisTick: { lineStyle: { color: '#30363d' } },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          type: 'line',
          data: data.map((d) => d.commits),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#3fb950', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(63, 185, 80, 0.3)' },
                { offset: 1, color: 'rgba(63, 185, 80, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [data]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No commit data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/charts/CommitTrendChart.tsx
git commit -m "feat: add CommitTrendChart with green gradient area"
```

---

### Task 15: Build IssuePrTrendChart

**Agent:** Visualization

**Files:**
- Create: `src/components/charts/IssuePrTrendChart.tsx`

**Step 1: Implement**

`src/components/charts/IssuePrTrendChart.tsx`:
```tsx
import { useMemo } from 'react';
import { useECharts } from '../../hooks/useECharts';
import { ChartContainer } from '../common/ChartContainer';
import type { IssuePrTrendData } from '../../utils/transformers';
import type { EChartsOption } from 'echarts';

interface IssuePrTrendChartProps {
  data: IssuePrTrendData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function IssuePrTrendChart({ data, loading, error }: IssuePrTrendChartProps) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2128',
        borderColor: '#30363d',
        textStyle: { color: '#f0f6fc' },
      },
      legend: {
        data: ['Issues', 'Pull Requests'],
        textStyle: { color: '#8b949e' },
        top: 0,
      },
      grid: { left: 50, right: 30, top: 40, bottom: 40 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.date),
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', rotate: 45, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          name: 'Issues',
          type: 'line',
          data: data.map((d) => d.issues),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#f0883e', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(240, 136, 62, 0.2)' },
                { offset: 1, color: 'rgba(240, 136, 62, 0.02)' },
              ],
            },
          },
        },
        {
          name: 'Pull Requests',
          type: 'line',
          data: data.map((d) => d.pullRequests),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#bc8cff', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(188, 140, 255, 0.2)' },
                { offset: 1, color: 'rgba(188, 140, 255, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [data]);

  const chartRef = useECharts(option);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No issue data">
      <div ref={chartRef} className="h-full w-full" />
    </ChartContainer>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/charts/IssuePrTrendChart.tsx
git commit -m "feat: add IssuePrTrendChart with dual area series"
```

---

### Task 16: Build ReleaseTimeline

**Agent:** Visualization

**Files:**
- Create: `src/components/charts/ReleaseTimeline.tsx`

**Step 1: Implement (CSS-based timeline, not ECharts — better for this use case)**

`src/components/charts/ReleaseTimeline.tsx`:
```tsx
import { ChartContainer } from '../common/ChartContainer';
import type { ReleaseTimelineData } from '../../utils/transformers';

interface ReleaseTimelineProps {
  data: ReleaseTimelineData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function ReleaseTimeline({ data, loading, error }: ReleaseTimelineProps) {
  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No releases found" height="h-auto">
      <div className="relative max-h-96 overflow-y-auto pr-2 custom-scrollbar">
        <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border-default" />
        <div className="space-y-0">
          {data?.slice(0, 15).map((release, i) => (
            <div key={release.tag} className="relative flex items-start gap-4 py-3 group">
              <div className={`relative z-10 mt-1 h-[10px] w-[10px] rounded-full border-2 flex-shrink-0
                ${release.prerelease
                  ? 'border-accent-yellow bg-bg-surface'
                  : i === 0
                    ? 'border-accent-green bg-accent-green'
                    : 'border-accent-blue bg-bg-surface'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={release.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm font-medium text-accent-blue hover:underline"
                  >
                    {release.tag}
                  </a>
                  {release.prerelease && (
                    <span className="rounded-full bg-accent-yellow/10 border border-accent-yellow/20 px-2 py-0.5 text-xs text-accent-yellow">
                      pre-release
                    </span>
                  )}
                  {i === 0 && !release.prerelease && (
                    <span className="rounded-full bg-accent-green/10 border border-accent-green/20 px-2 py-0.5 text-xs text-accent-green">
                      latest
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-text-muted">{release.date}</span>
                  {release.name !== release.tag && (
                    <span className="text-xs text-text-secondary truncate">{release.name}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ChartContainer>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/charts/ReleaseTimeline.tsx
git commit -m "feat: add ReleaseTimeline with CSS-based vertical timeline"
```

---

### Task 17: Build CommitHeatmap

**Agent:** Visualization

**Files:**
- Create: `src/components/charts/CommitHeatmap.tsx`

**Step 1: Implement (custom SVG — GitHub-style grid)**

`src/components/charts/CommitHeatmap.tsx`:
```tsx
import { useMemo } from 'react';
import dayjs from 'dayjs';
import { ChartContainer } from '../common/ChartContainer';
import type { HeatmapData } from '../../utils/transformers';

interface CommitHeatmapProps {
  data: HeatmapData[] | undefined;
  loading: boolean;
  error: Error | null;
}

const CELL_SIZE = 12;
const CELL_GAP = 3;
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function getColor(count: number, max: number): string {
  if (count === 0) return '#161b22';
  const intensity = count / max;
  if (intensity < 0.25) return '#0e4429';
  if (intensity < 0.5) return '#006d32';
  if (intensity < 0.75) return '#26a641';
  return '#39d353';
}

export default function CommitHeatmap({ data, loading, error }: CommitHeatmapProps) {
  const { grid, weeks, maxCount, months } = useMemo(() => {
    if (!data || data.length === 0) return { grid: [], weeks: 0, maxCount: 0, months: [] };

    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const maxCount = Math.max(...data.map((d) => d.count), 1);
    const dataMap = new Map(sorted.map((d) => [d.date, d.count]));

    const startDate = dayjs(sorted[0].date).startOf('week');
    const endDate = dayjs(sorted[sorted.length - 1].date);
    const weeks = Math.ceil(endDate.diff(startDate, 'day') / 7) + 1;

    const grid: Array<{ x: number; y: number; date: string; count: number }> = [];
    const months: Array<{ label: string; x: number }> = [];
    let lastMonth = -1;

    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        const currentDate = startDate.add(week * 7 + day, 'day');
        const dateStr = currentDate.format('YYYY-MM-DD');
        const count = dataMap.get(dateStr) || 0;

        grid.push({
          x: week * (CELL_SIZE + CELL_GAP),
          y: day * (CELL_SIZE + CELL_GAP),
          date: dateStr,
          count,
        });

        if (day === 0 && currentDate.month() !== lastMonth) {
          lastMonth = currentDate.month();
          months.push({
            label: currentDate.format('MMM'),
            x: week * (CELL_SIZE + CELL_GAP),
          });
        }
      }
    }

    return { grid, weeks, maxCount, months };
  }, [data]);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={!data || data.length === 0} emptyMessage="No commit data" height="h-auto">
      <div className="overflow-x-auto pb-2">
        <svg
          width={weeks * (CELL_SIZE + CELL_GAP) + 40}
          height={7 * (CELL_SIZE + CELL_GAP) + 30}
        >
          {/* Month labels */}
          {months.map((month, i) => (
            <text
              key={i}
              x={month.x + 40}
              y={10}
              className="text-[10px] fill-text-muted"
            >
              {month.label}
            </text>
          ))}

          {/* Day labels */}
          {DAYS.map((day, i) => (
            <text
              key={i}
              x={0}
              y={20 + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2}
              className="text-[10px] fill-text-muted"
            >
              {day}
            </text>
          ))}

          {/* Grid */}
          {grid.map((cell) => (
            <rect
              key={cell.date}
              x={cell.x + 40}
              y={cell.y + 18}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={getColor(cell.count, maxCount)}
              className="transition-colors hover:stroke-text-muted hover:stroke-1"
            >
              <title>{`${cell.date}: ${cell.count} commits`}</title>
            </rect>
          ))}
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-2 text-xs text-text-muted">
          <span>Less</span>
          {['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'].map((color) => (
            <div
              key={color}
              className="h-[10px] w-[10px] rounded-sm"
              style={{ backgroundColor: color }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </ChartContainer>
  );
}
```

**Step 2: Create chart barrel export**

`src/components/charts/index.ts`:
```ts
export { default as LanguagePieChart } from './LanguagePieChart';
export { default as ContributorBarChart } from './ContributorBarChart';
export { default as CommitTrendChart } from './CommitTrendChart';
export { default as IssuePrTrendChart } from './IssuePrTrendChart';
export { default as ReleaseTimeline } from './ReleaseTimeline';
export { default as CommitHeatmap } from './CommitHeatmap';
```

**Step 3: Verify full build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/components/charts/
git commit -m "feat: add CommitHeatmap SVG grid and chart barrel exports"
```

---

## Phase 8: Authentication System

### Task 18: Create Vercel Serverless Function for OAuth

**Agent:** Auth

**Files:**
- Create: `api/auth/github.ts`

**Step 1: Implement**

`api/auth/github.ts`:
```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' });
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await response.json();

  if (data.error) {
    return res.status(400).json({ error: data.error_description || data.error });
  }

  return res.status(200).json({ access_token: data.access_token });
}
```

**Step 2: Commit**

```bash
git add api/
git commit -m "feat: add Vercel serverless function for GitHub OAuth token exchange"
```

---

### Task 19: Build Auth Callback Page

**Agent:** Auth

**Files:**
- Create: `src/pages/AuthCallback.tsx`

**Step 1: Implement**

`src/pages/AuthCallback.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('No authorization code received');
      return;
    }

    async function exchangeToken(code: string) {
      try {
        // Exchange code for token
        const tokenRes = await fetch('/api/auth/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error);

        // Fetch user info
        const userRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const userData = await userRes.json();

        setAuth(tokenData.access_token, {
          login: userData.login,
          avatar_url: userData.avatar_url,
        });

        // Navigate to last page or home
        const returnTo = sessionStorage.getItem('auth-return-to') || '/';
        sessionStorage.removeItem('auth-return-to');
        navigate(returnTo, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    }

    exchangeToken(code);
  }, [searchParams, setAuth, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="h-12 w-12 rounded-full bg-accent-red/10 flex items-center justify-center mb-4">
          <svg className="h-6 w-6 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Authentication Failed</h2>
        <p className="text-text-secondary mb-4">{error}</p>
        <button onClick={() => navigate('/')} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/90 transition-colors">
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin mb-4" />
      <p className="text-text-secondary">Authenticating with GitHub...</p>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/pages/AuthCallback.tsx
git commit -m "feat: add AuthCallback page with token exchange and user fetch"
```

---

## Phase 9: Refactor + Performance

### Task 20: Add dayjs RelativeTime plugin + Final Polish

**Agent:** QA/Refactor

**Files:**
- Create: `src/utils/dayjs.ts`
- Modify: `src/main.tsx` (import dayjs setup)
- Modify: `src/components/repo/RepoOverview.tsx` (use fromNow)

**Step 1: Set up dayjs plugins**

`src/utils/dayjs.ts`:
```ts
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export default dayjs;
```

**Step 2: Import in main.tsx** — add `import './utils/dayjs';` at the top.

**Step 3: Create .env.example**

`.env.example`:
```
VITE_GITHUB_CLIENT_ID=your_github_oauth_app_client_id
GITHUB_CLIENT_ID=your_github_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_app_client_secret
```

**Step 4: Create .gitignore update**

Ensure `.env` is in `.gitignore`.

**Step 5: Verify build**

```bash
npm run build
```

**Step 6: Commit**

```bash
git add src/utils/dayjs.ts src/main.tsx .env.example
git commit -m "chore: add dayjs relative time plugin and env example"
```

---

### Task 21: Add Zod Validation for Search Input

**Agent:** QA/Refactor

**Files:**
- Create: `src/utils/validators.ts`

**Step 1: Implement**

`src/utils/validators.ts`:
```ts
import { z } from 'zod';

export const repoSlugSchema = z
  .string()
  .trim()
  .transform((val) => val.replace(/\/$/, ''))
  .pipe(
    z.union([
      z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/, 'Invalid repository format'),
      z.string().url().transform((url) => {
        const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) throw new Error('Not a valid GitHub URL');
        return `${match[1]}/${match[2]}`;
      }),
    ]),
  );

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const result = repoSlugSchema.safeParse(input);
  if (!result.success) return null;
  const [owner, repo] = result.data.split('/');
  return owner && repo ? { owner, repo } : null;
}
```

**Step 2: Commit**

```bash
git add src/utils/validators.ts
git commit -m "feat: add Zod-based repo input validator"
```

---

## Phase 10: README + Documentation

### Task 22: Write README

**Agent:** QA/Refactor

**Files:**
- Create: `README.md`

**Step 1: Write README with project overview, setup instructions, architecture overview, and screenshots placeholder**

Include sections:
- Project title + description
- Screenshots (placeholder)
- Tech stack
- Getting started (clone, install, env setup, dev server)
- Project architecture (folder structure diagram)
- Features
- Deployment (Vercel)
- License

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with setup and architecture docs"
```

---

## Summary

**22 tasks** across **9 implementation phases** (Phase 1 was planning).

| Phase | Tasks | Agent(s) |
|-------|-------|----------|
| 2. Setup | 1-3 | Architect |
| 3. API | 4-6 | API Integration, State Mgmt |
| 4. Layout | 7-8 | Frontend UI |
| 5. Home | 9 | Frontend UI |
| 6. Dashboard | 10 | Frontend UI |
| 7. Charts | 11-17 | Visualization |
| 8. Auth | 18-19 | Auth |
| 9. Refactor | 20-21 | QA/Refactor |
| 10. Docs | 22 | QA/Refactor |

**Parallelism opportunities:**
- Tasks 4+5+6 (API client, transformers, hooks) can run in parallel after Task 3
- Tasks 12-17 (individual chart components) can all run in parallel after Task 11
- Tasks 18+19 (auth serverless + callback) can run in parallel
- Tasks 20+21+22 (polish tasks) can all run in parallel
