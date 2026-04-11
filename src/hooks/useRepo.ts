import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';

export function useRepo(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repoSnapshot', owner, repo],
    queryFn: () => githubApi.getRepoSnapshot(owner, repo),
    select: (snapshot) => snapshot.repo,
    enabled: !!owner && !!repo,
  });
}
