import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { githubApi } from '../api/github';
import type { IssuePrTrendData } from '../utils/transformers';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function cacheKey(owner: string, repo: string) {
  return `issues-cache:${owner}/${repo}`;
}

function readCache(owner: string, repo: string): IssuePrTrendData[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: IssuePrTrendData[]; ts: number };
    if (Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(owner, repo));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeCache(owner: string, repo: string, data: IssuePrTrendData[]) {
  try {
    localStorage.setItem(cacheKey(owner, repo), JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // ignore QuotaExceededError and similar
  }
}

export function useIssues(owner: string, repo: string) {
  return useQuery<IssuePrTrendData[]>({
    queryKey: ['issues', owner, repo],
    queryFn: async () => {
      const cached = readCache(owner, repo);
      if (cached) return cached;

      const data = await githubApi.getMonthlyIssuePrCounts(owner, repo, 12);
      const result = data.map((d) => ({
        date: dayjs(d.month).format('MMM YYYY'),
        issues: d.issues,
        pullRequests: d.pullRequests,
      }));
      writeCache(owner, repo, result);
      return result;
    },
    enabled: !!owner && !!repo,
  });
}
