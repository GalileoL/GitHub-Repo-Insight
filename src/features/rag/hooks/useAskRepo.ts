import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { askRepoStream } from '../api/rag';
import { useAuthStore } from '../../../store/auth';
import { useAskHistory } from './useAskHistory';
import type { Source } from '../types';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'cancelled' | 'error';

export function useAskRepo(repo: string) {
  const token = useAuthStore((s) => s.token);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [streamError, setStreamError] = useState<string | null>(null);
  const answerRef = useRef('');
  const sourcesRef = useRef<Source[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { history, addEntry, clearHistory } = useAskHistory(repo);

  const mutation = useMutation<void, Error, string>({
    mutationFn: async (question: string) => {
      // Reset state
      setStreamingAnswer('');
      setSources([]);
      setStreamStatus('idle');
      setStreamError(null);
      answerRef.current = '';
      sourcesRef.current = [];
      
      abortControllerRef.current = new AbortController();

      try {
        await askRepoStream(
          repo,
          question,
          token ?? undefined,
          {
            signal: abortControllerRef.current.signal,
            onDelta: (delta) => {
              answerRef.current += delta;
              setStreamingAnswer((prev) => prev + delta);
            },
            onSources: (newSources) => {
              sourcesRef.current = newSources;
              setSources(newSources);
            },
            onError: (error) => {
              setStreamError(error);
              setStreamStatus('error');
            },
            onStatus: (status) => {
              setStreamStatus(status);
            },
          },
        );
        // Save completed answer to history only if fully streamed
        if (answerRef.current && streamStatus !== 'error') {
          addEntry({
            question,
            answer: answerRef.current,
            sources: sourcesRef.current,
            timestamp: Date.now(),
          });
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
  });

  /** Abort the ongoing stream and preserve the partial answer */
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStreamStatus('cancelled');
    }
  }, []);

  /** Retry streaming the same answer from where it left off (partial recovery) */
  const retry = useCallback(() => {
    if (mutation.variables) {
      mutation.mutate(mutation.variables);
    }
  }, [mutation]);

  /** Show a cached history entry directly without making an API call */
  const showCached = useCallback(
    (entry: { answer: string; sources: Source[] }) => {
      mutation.reset();
      setStreamingAnswer(entry.answer);
      setSources(entry.sources);
      setStreamStatus('done');
      setStreamError(null);
    },
    [mutation],
  );

  const reset = useCallback(() => {
    setStreamingAnswer('');
    setSources([]);
    setStreamStatus('idle');
    setStreamError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    mutation.reset();
  }, [mutation]);

  return {
    ask: mutation.mutate,
    showCached,
    streamingAnswer,
    sources,
    streamStatus,
    streamError,
    cancel,
    retry,
    isStreaming: streamStatus === 'streaming' || streamStatus === 'connecting',
    isPending: mutation.isPending,
    isError: mutation.isError || streamStatus === 'error',
    error: mutation.error,
    isSuccess: streamStatus === 'done',
    reset,
    history,
    clearHistory,
  };
}
