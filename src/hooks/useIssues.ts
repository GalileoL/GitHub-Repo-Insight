import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { githubApi } from '../api/github';
import type { IssuePrTrendData } from '../utils/transformers';

export function useIssues(owner: string, repo: string) {
  return useQuery<IssuePrTrendData[]>({
    queryKey: ['issues', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getMonthlyIssuePrCounts(owner, repo, 12);
      return data.map((d) => ({
        date: dayjs(d.month).format('MMM YYYY'),
        issues: d.issues,
        pullRequests: d.pullRequests,
      }));
    },
    enabled: !!owner && !!repo,
  });
}
