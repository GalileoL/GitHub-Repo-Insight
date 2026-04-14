import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchIngestStatus, ingestRepo } from '../api/rag';

export function useIngestStatus(repo: string) {
  return useQuery({
    queryKey: ['rag-status', repo],
    queryFn: () => fetchIngestStatus(repo),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useIngestRepo(repo: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => ingestRepo(repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rag-status', repo] });
    },
  });
}
