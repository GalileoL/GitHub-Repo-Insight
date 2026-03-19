import type { AskResponse, IngestResponse, StatusResponse, Source } from '../types';

export async function fetchIngestStatus(repo: string): Promise<StatusResponse> {
  const res = await fetch(`/api/rag/status?repo=${encodeURIComponent(repo)}`);
  if (!res.ok) throw new Error('Failed to check index status');
  return res.json();
}

export async function ingestRepo(repo: string, token?: string): Promise<IngestResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/rag/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify({ repo }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Ingestion failed');
  }
  return res.json();
}

export async function askRepo(repo: string, question: string, token?: string): Promise<AskResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/rag/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ repo, question }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to get answer');
  }
  return res.json();
}

export interface SSEStreamOptions {
  signal?: AbortSignal;
  onDelta?: (content: string) => void;
  onSources?: (sources: Source[]) => void;
  onError?: (error: string) => void;
  onStatus?: (status: 'connecting' | 'streaming' | 'done' | 'cancelled') => void;
}

/** Enhanced SSE streaming with AbortController support, unified event protocol, and error handling */
export async function askRepoStream(
  repo: string,
  question: string,
  token: string | undefined,
  options: SSEStreamOptions,
): Promise<void> {
  const { signal, onDelta, onSources, onError, onStatus } = options;
  
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    onStatus?.('connecting');
    const res = await fetch('/api/rag/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repo, question, stream: true }),
      signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? 'Failed to get answer');
    }

    if (!res.body) {
      throw new Error('Streaming response body is not available in this environment');
    }

    onStatus?.('streaming');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;
        
        if (dataStr === '[DONE]') {
          onStatus?.('done');
          return;
        }

        try {
          const event = JSON.parse(dataStr);
          if (event.type === 'delta' && event.content) {
            onDelta?.(event.content);
          } else if (event.type === 'sources' && event.sources) {
            onSources?.(event.sources);
          } else if (event.type === 'error') {
            throw new Error(event.message ?? 'Server error');
          }
        } catch (err) {
          // Continue on individual line parse errors to handle SSE fragmentation
          if (err instanceof SyntaxError) {
            // Silently skip malformed lines
            continue;
          }
          throw err;
        }
      }
    }
    onStatus?.('done');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      onStatus?.('cancelled');
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    onError?.(message);
    throw err;
  }
}
