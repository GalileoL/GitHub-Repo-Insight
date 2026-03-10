import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';

export function useRepo(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repo', owner, repo],
    queryFn: () => githubApi.getRepo(owner, repo),
    enabled: !!owner && !!repo,
  });
}
