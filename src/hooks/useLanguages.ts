import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformLanguages } from '../utils/transformers';

export function useLanguages(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repoSnapshot', owner, repo],
    queryFn: async () => {
      const snapshot = await githubApi.getRepoSnapshot(owner, repo);
      return transformLanguages(snapshot.languages);
    },
    enabled: !!owner && !!repo,
  });
}
