import type { AskResponse, IngestResponse, StatusResponse, Source } from '../types';

// ============================================================================
// Client-side Metrics (inlined to avoid cross-compilation boundary)
// ============================================================================

export const ErrorCategory = {
  NETWORK: 'network',
  SERVER_LLM: 'server_llm',
  PARSING: 'parsing',
  TIMEOUT: 'timeout',
  EXTERNAL_API: 'external_api',
  RATE_LIMIT: 'rate_limit',
  AUTH: 'auth',
  UNKNOWN: 'unknown',
} as const;

export type ErrorCategoryType = typeof ErrorCategory[keyof typeof ErrorCategory];

export interface ClientStreamMetrics {
  requestId: string;
  startTime: number;
  firstByteTime?: number;
  parseStartTime?: number;
  parseEndTime?: number;
  endTime?: number;
  duration?: number;
  ttfb?: number;
  chunkCount?: number;
  sourceCount?: number;
  errorCategory?: ErrorCategoryType;
  errorMessage?: string;
  cancelled?: boolean;
}

function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

export function categorizeError(error: Error | string, context?: { httpStatus?: number }): ErrorCategoryType {
  const message = typeof error === 'string' ? error : error.message;
  const httpStatus = context?.httpStatus;

  if (httpStatus === 401) return ErrorCategory.AUTH;
  if (httpStatus === 429) return ErrorCategory.RATE_LIMIT;
  if (httpStatus === 408 || httpStatus === 504 || httpStatus === 503) return ErrorCategory.TIMEOUT;

  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('econnaborted')) {
    return ErrorCategory.TIMEOUT;
  }
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('network')) {
    return ErrorCategory.NETWORK;
  }
  if (lowerMsg.includes('rate limit') || lowerMsg.includes('quota') || lowerMsg.includes('too many requests')) {
    return ErrorCategory.RATE_LIMIT;
  }
  if (lowerMsg.includes('auth') || lowerMsg.includes('unauthorized') || lowerMsg.includes('invalid token')) {
    return ErrorCategory.AUTH;
  }
  if (lowerMsg.includes('json') || lowerMsg.includes('parse') || error instanceof SyntaxError) {
    return ErrorCategory.PARSING;
  }
  if (lowerMsg.includes('api key') || lowerMsg.includes('model unavailable')) {
    return ErrorCategory.SERVER_LLM;
  }
  if (lowerMsg.includes('github') || lowerMsg.includes('external')) {
    return ErrorCategory.EXTERNAL_API;
  }

  return ErrorCategory.UNKNOWN;
}

export class ClientMetricsRecorder {
  private metrics: ClientStreamMetrics;

  constructor(requestId: string = generateRequestId()) {
    this.metrics = {
      requestId,
      startTime: Date.now(),
      chunkCount: 0,
      sourceCount: 0,
    };
  }

  getRequestId(): string {
    return this.metrics.requestId;
  }

  setRequestId(requestId: string): void {
    this.metrics.requestId = requestId;
  }

  recordFirstByte(): void {
    if (!this.metrics.firstByteTime) {
      this.metrics.firstByteTime = Date.now();
      this.metrics.ttfb = this.metrics.firstByteTime - this.metrics.startTime;
    }
  }

  recordParseStart(): void {
    if (!this.metrics.parseStartTime) {
      this.metrics.parseStartTime = Date.now();
    }
  }

  recordParseEnd(): void {
    if (!this.metrics.parseEndTime) {
      this.metrics.parseEndTime = Date.now();
    }
  }

  incrementChunkCount(): void {
    this.metrics.chunkCount = (this.metrics.chunkCount ?? 0) + 1;
  }

  setSourceCount(count: number): void {
    this.metrics.sourceCount = count;
  }

  recordError(error: Error | string, category?: ErrorCategoryType): void {
    this.metrics.errorCategory = category ?? categorizeError(error);
    this.metrics.errorMessage = typeof error === 'string' ? error : error.message;
  }

  recordCancelled(): void {
    this.metrics.cancelled = true;
  }

  end(): ClientStreamMetrics {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    return { ...this.metrics };
  }

  getSnapshot(): ClientStreamMetrics {
    return {
      ...this.metrics,
      endTime: this.metrics.endTime,
      duration: this.metrics.endTime ? this.metrics.endTime - this.metrics.startTime : undefined,
    };
  }
}

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
  onDelta?: (content: string, seq?: number) => void;
  onSources?: (sources: Source[]) => void;
  onError?: (error: string) => void;
  onStatus?: (status: 'connecting' | 'streaming' | 'reconnecting' | 'done' | 'cancelled') => void;
  onMetrics?: (metrics: ClientStreamMetrics) => void;

  /** For resuming a previously-started stream */
  resume?: boolean;
  /** Required when resuming */
  requestId?: string;
  /** Required when resuming */
  lastSeq?: number;
}

/** Enhanced SSE streaming with AbortController support, unified event protocol, metrics, and error handling */
export async function askRepoStream(
  repo: string,
  question: string,
  token: string | undefined,
  options: SSEStreamOptions,
): Promise<void> {
  const { signal, onDelta, onSources, onError, onStatus, onMetrics, requestId, lastSeq, resume } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Initialize metrics recorder (may be overwritten with server requestId)
  const metrics = new ClientMetricsRecorder(requestId);

  try {
    onStatus?.('connecting');

    const endpoint = resume ? '/api/rag/resume' : '/api/rag/ask';
    const body: Record<string, unknown> = resume
      ? { requestId, lastSeq }
      : { repo, question, stream: true };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const error = new Error(data.error ?? 'Failed to get answer');
      metrics.recordError(error, categorizeError(error, { httpStatus: res.status }));
      throw error;
    }

    if (!res.body) {
      const error = new Error('Streaming response body is not available in this environment');
      metrics.recordError(error);
      throw error;
    }

    // Extract request ID from response header for tracing
    const serverRequestId = res.headers.get('X-Request-ID');
    if (serverRequestId) {
      metrics.setRequestId(serverRequestId);
      // Early metrics callback so caller can store requestId for resume
      onMetrics?.(metrics.getSnapshot());
    }

    onStatus?.('streaming');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstByteReceived = false;
    let lastSeenSeq = typeof lastSeq === 'number' ? lastSeq : 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Record first byte received (TTFB)
      if (!firstByteReceived && value.length > 0) {
        firstByteReceived = true;
        metrics.recordFirstByte();
        metrics.recordParseStart();
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;
        
        if (dataStr === '[DONE]') {
          metrics.recordParseEnd();
          onStatus?.('done');
          return;
        }

        try {
          const event = JSON.parse(dataStr);
          if (event.type === 'delta' && event.content) {
            const seq = typeof event.seq === 'number' ? event.seq : undefined;
            if (typeof seq === 'number') {
              if (seq <= lastSeenSeq) {
                continue; // skip duplicates when resuming
              }
              lastSeenSeq = seq;
            }

            metrics.incrementChunkCount();
            onDelta?.(event.content, seq);
          } else if (event.type === 'sources' && event.sources) {
            metrics.setSourceCount(event.sources.length);
            onSources?.(event.sources);
          } else if (event.type === 'heartbeat') {
            // Silently ignore heartbeat events (no action needed)
            continue;
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
    metrics.recordParseEnd();
    onStatus?.('done');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      metrics.recordCancelled();
      onStatus?.('cancelled');
      const finalMetrics = metrics.end();
      onMetrics?.(finalMetrics);
      return;
    }
    const errorObj = err instanceof Error ? err : new Error(String(err));
    const message = errorObj.message || 'Unknown error';
    metrics.recordError(errorObj, categorizeError(errorObj));
    onError?.(message);
    const finalMetrics = metrics.end();
    onMetrics?.(finalMetrics);
    throw errorObj;
  } finally {
    // Ensure metrics are captured even on success
    if (!metrics.getSnapshot().endTime) {
      const finalMetrics = metrics.end();
      onMetrics?.(finalMetrics);
    }
  }
}
