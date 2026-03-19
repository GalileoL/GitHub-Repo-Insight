import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { askRepoStream } from '../api/rag';
import { useAuthStore } from '../../../store/auth';
import { useAskHistory } from './useAskHistory';
import type { Source } from '../types';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'done' | 'cancelled' | 'error';

export function useAskRepo(repo: string) {
  const token = useAuthStore((s) => s.token);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [previousAnswer, setPreviousAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [streamError, setStreamError] = useState<string | null>(null);

  const makeCacheKey = (question: string) => {
    const hash = question
      .split('')
      .reduce((h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0, 0)
      .toString(36);
    return `rag-cache:${repo}:${hash}`;
  };

  const getCachedAnswer = (question: string) => {
    try {
      const key = makeCacheKey(question);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { answer: string; sources: Source[]; ts: number };
      const age = Date.now() - parsed.ts;
      const maxAge = 1000 * 60 * 60 * 12; // 12h
      if (age > maxAge) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const setCachedAnswer = (question: string, answer: string, sources: Source[]) => {
    try {
      const key = makeCacheKey(question);
      localStorage.setItem(key, JSON.stringify({ answer, sources, ts: Date.now() }));
    } catch {
      // ignore
    }
  };
  const answerRef = useRef('');
  const sourcesRef = useRef<Source[]>([]);
  const deltaBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef<number>(0);
  const isResumingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { history, addEntry, clearHistory } = useAskHistory(repo);

  const mutation = useMutation<void, Error, string>({
    mutationFn: async (question: string) => {
      // If we've recently asked the same question, return cached answer.
      const cached = getCachedAnswer(question);
      if (cached) {
        setPreviousAnswer(null);
        setStreamingAnswer(cached.answer);
        setSources(cached.sources);
        setStreamStatus('done');
        setStreamError(null);
        answerRef.current = cached.answer;
        sourcesRef.current = cached.sources;
        return;
      }

      // Reset state
      setPreviousAnswer(null);
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
            onDelta: (delta, seq) => {
              if (typeof seq === 'number') {
                lastSeqRef.current = seq;
              }

              // Buffer delta updates to reduce render churn on fast streams.
              deltaBufferRef.current += delta;
              if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(() => {
                  const buffered = deltaBufferRef.current;
                  deltaBufferRef.current = '';
                  flushTimerRef.current = null;
                  answerRef.current += buffered;
                  setStreamingAnswer((prev) => prev + buffered);
                }, 50);
              }
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
              // When resuming, keep the UI in "reconnecting" until the connection stabilizes
              if (status === 'connecting' && isResumingRef.current) {
                setStreamStatus('reconnecting');
                return;
              }
              setStreamStatus(status);
            },
            onMetrics: (metrics) => {
              requestIdRef.current = metrics.requestId;
              lastSeqRef.current = metrics.chunkCount ?? lastSeqRef.current;
            },
          },
        );
        // Cache the fully streamed answer for quick re-use
        if (answerRef.current && streamStatus !== 'error') {
          addEntry({
            question,
            answer: answerRef.current,
            sources: sourcesRef.current,
            timestamp: Date.now(),
          });
          setCachedAnswer(question, answerRef.current, sourcesRef.current);
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
  });

  /** Abort the ongoing stream and preserve the partial answer */
  const cancel = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    isResumingRef.current = false;
    setStreamStatus('cancelled');
  }, []);

  /** Retry streaming the same answer from where it left off (partial recovery) */
  const retry = useCallback(async () => {
    if (!mutation.variables) return;

    // Store the current answer so we can show a diff when retry completes.
    setPreviousAnswer(answerRef.current);

    // Clear any pending retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Reset retry counter when user manually triggers retry
    retryCountRef.current = 0;

    // If we have an active request ID, try resuming the previous stream
    if (requestIdRef.current) {
      // Start a new abort controller for the resumed stream
      abortControllerRef.current = new AbortController();
      setStreamError(null);
      setStreamStatus('reconnecting');

      const performResume = async () => {
        isResumingRef.current = true;
        try {
          await askRepoStream(repo, mutation.variables, token ?? undefined, {
            signal: abortControllerRef.current?.signal,
            requestId: requestIdRef.current!,
            lastSeq: lastSeqRef.current,
            resume: true,
            onDelta: (delta, seq) => {
              if (typeof seq === 'number') {
                lastSeqRef.current = seq;
              }

              deltaBufferRef.current += delta;
              if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(() => {
                  const buffered = deltaBufferRef.current;
                  deltaBufferRef.current = '';
                  flushTimerRef.current = null;
                  answerRef.current += buffered;
                  setStreamingAnswer((prev) => prev + buffered);
                }, 50);
              }
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
            onMetrics: (metrics) => {
              requestIdRef.current = metrics.requestId;
              lastSeqRef.current = metrics.chunkCount ?? lastSeqRef.current;
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const retryable = /failed to fetch|network|timeout|connection|abort/i.test(message);
          if (retryable && retryCountRef.current < 3) {
            retryCountRef.current += 1;
            const delay = 1000 * Math.pow(2, retryCountRef.current - 1);
            setStreamStatus('reconnecting');
            retryTimerRef.current = setTimeout(performResume, delay);
          } else {
            setStreamError(message);
            setStreamStatus('error');
          }
        } finally {
          isResumingRef.current = false;
        }
      };

      await performResume();
      return;
    }

    mutation.mutate(mutation.variables);
  }, [mutation, repo, token]);

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
    answerRef.current = '';
    sourcesRef.current = [];
    requestIdRef.current = null;
    lastSeqRef.current = 0;
    isResumingRef.current = false;
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    mutation.reset();
  }, [mutation]);

  const setAnswer = useCallback((text: string) => {
    answerRef.current = text;
    setStreamingAnswer(text);
  }, []);

  return {
    ask: mutation.mutate,
    showCached,
    streamingAnswer,
    previousAnswer,
    sources,
    streamStatus,
    streamError,
    cancel,
    retry,
    setAnswer,
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
