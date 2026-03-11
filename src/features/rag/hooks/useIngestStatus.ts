import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchIngestStatus, ingestRepo } from '../api/rag';
import { useAuthStore } from '../../../store/auth';

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
  const token = useAuthStore((s) => s.token);

  return useMutation({
    mutationFn: () => ingestRepo(repo, token ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rag-status', repo] });
    },
  });
}
