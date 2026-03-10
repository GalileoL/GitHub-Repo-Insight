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
