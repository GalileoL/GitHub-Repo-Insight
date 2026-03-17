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

/** SSE streaming variant of askRepo. Calls onDelta for each text chunk, onSources when sources arrive. */
export async function askRepoStream(
  repo: string,
  question: string,
  token: string | undefined,
  onDelta: (content: string) => void,
  onSources: (sources: Source[]) => void,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/rag/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ repo, question, stream: true }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to get answer');
  }

  if (!res.body) {
    throw new Error('Streaming response body is not available in this environment');
  }

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
      const data = line.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'delta') {
          onDelta(parsed.content);
        } else if (parsed.type === 'sources') {
          onSources(parsed.sources);
        }
      } catch {
        // Ignore malformed partial lines and continue stream consumption.
      }
    }
  }
}
