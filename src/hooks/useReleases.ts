import { useInfiniteQuery } from '@tanstack/react-query';
import { githubApi } from '../api/github';
import { transformReleases } from '../utils/transformers';

export function useReleases(owner: string, repo: string) {
  return useInfiniteQuery({
    queryKey: ['releases', owner, repo],
    queryFn: async ({ pageParam = 1 }) => {
      const data = await githubApi.getReleasesPage(owner, repo, pageParam);
      return transformReleases(data);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      // If we got fewer than 20 results, there are no more pages
      if (lastPage.length < 20) return undefined;
      return lastPageParam + 1;
    },
    enabled: !!owner && !!repo,
  });
}
