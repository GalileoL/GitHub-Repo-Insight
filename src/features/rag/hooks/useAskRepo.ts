import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { askRepoStream } from '../api/rag';
import { useAuthStore } from '../../../store/auth';
import { useAskHistory } from './useAskHistory';
import type { Source } from '../types';

export function useAskRepo(repo: string) {
  const token = useAuthStore((s) => s.token);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const answerRef = useRef('');
  const sourcesRef = useRef<Source[]>([]);
  const { history, addEntry, clearHistory } = useAskHistory(repo);

  const mutation = useMutation<void, Error, string>({
    mutationFn: async (question: string) => {
      // Reset state
      setStreamingAnswer('');
      setSources([]);
      setIsStreaming(true);
      answerRef.current = '';
      sourcesRef.current = [];

      try {
        await askRepoStream(
          repo,
          question,
          token ?? undefined,
          (delta) => {
            answerRef.current += delta;
            setStreamingAnswer((prev) => prev + delta);
          },
          (newSources) => {
            sourcesRef.current = newSources;
            setSources(newSources);
          },
        );
        // Save completed answer to history (deduplicate by question text)
        if (answerRef.current) {
          addEntry({
            question,
            answer: answerRef.current,
            sources: sourcesRef.current,
            timestamp: Date.now(),
          });
        }
      } finally {
        setIsStreaming(false);
      }
    },
  });

  /** Show a cached history entry directly without making an API call */
  const showCached = useCallback(
    (entry: { answer: string; sources: Source[] }) => {
      mutation.reset();
      setStreamingAnswer(entry.answer);
      setSources(entry.sources);
      setIsStreaming(false);
    },
    [mutation],
  );

  const reset = useCallback(() => {
    setStreamingAnswer('');
    setSources([]);
    setIsStreaming(false);
    mutation.reset();
  }, [mutation]);

  return {
    ask: mutation.mutate,
    showCached,
    streamingAnswer,
    sources,
    isStreaming,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    reset,
    history,
    clearHistory,
  };
}
