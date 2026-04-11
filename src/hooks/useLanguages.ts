import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformLanguages } from '../utils/transformers';

export function useLanguages(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repoSnapshot', owner, repo],
    queryFn: () => githubApi.getRepoSnapshot(owner, repo),
    select: (snapshot) => transformLanguages(snapshot.languages),
    enabled: !!owner && !!repo,
  });
}
