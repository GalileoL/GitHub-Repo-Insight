import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformIssuesAndPrs } from '../utils/transformers';

export function useIssues(owner: string, repo: string) {
  return useQuery({
    queryKey: ['issues', owner, repo],
    queryFn: async () => {
      const data = await githubApi.getIssuesPaginated(owner, repo, 5);
      return transformIssuesAndPrs(data);
    },
    enabled: !!owner && !!repo,
  });
}
