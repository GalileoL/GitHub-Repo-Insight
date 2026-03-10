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
