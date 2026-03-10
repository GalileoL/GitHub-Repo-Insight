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
