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
