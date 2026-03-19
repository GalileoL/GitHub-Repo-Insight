/**
 * Metrics collection for SSE streaming with heartbeat, request tracing, and error categorization.
 * Phase 2 implementation: Reliability & Observability.
 */

/**
 * Error categories for detailed error handling and troubleshooting
 */
export const ErrorCategory = {
  /** Network-related errors: timeout, connection refused, DNS failure */
  NETWORK: 'network',
  /** Server-side LLM errors: API key invalid, rate limit, model unavailable */
  SERVER_LLM: 'server_llm',
  /** Stream parsing errors: malformed JSON, SSE protocol violation */
  PARSING: 'parsing',
  /** Proxy/network timeout errors */
  TIMEOUT: 'timeout',
  /** GitHub or external API errors during retrieval */
  EXTERNAL_API: 'external_api',
  /** Rate limit or quota errors */
  RATE_LIMIT: 'rate_limit',
  /** Authentication failures */
  AUTH: 'auth',
  /** Unknown or uncategorized errors */
  UNKNOWN: 'unknown',
} as const;

export type ErrorCategoryType = typeof ErrorCategory[keyof typeof ErrorCategory];

/**
 * Server-side stream metrics
 */
export interface ServerStreamMetrics {
  requestId: string;
  startTime: number; // milliseconds since epoch
  chunkCount: number; // retrieved chunks used for answer
  eventCount: number; // total SSE events sent
  errorCount: number; // number of errors during stream
  endTime?: number; // milliseconds since epoch (set when stream ends)
  duration?: number; // ms (computed: endTime - startTime)
  errorCategory?: ErrorCategoryType;
  errorMessage?: string;
}

/**
 * Client-side stream metrics
 */
export interface ClientStreamMetrics {
  requestId: string;
  startTime: number; // milliseconds since epoch
  firstByteTime?: number; // TTFB: time to first delta
  parseStartTime?: number; // when first parse event received
  parseEndTime?: number; // when [DONE] received
  endTime?: number; // milliseconds since epoch
  duration?: number; // total time from start to end (ms)
  ttfb?: number; // time to first byte (ms)
  chunkCount?: number; // number of delta events received
  sourceCount?: number; // number of sources returned
  errorCategory?: ErrorCategoryType;
  errorMessage?: string;
  cancelled?: boolean;
}

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

/**
 * Generate a random ID for heartbeat events
 */
export function generateHeartbeatId(): string {
  return `hb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Categorize an error based on its message and type
 */
export function categorizeError(error: Error | string, context?: { httpStatus?: number }): ErrorCategoryType {
  const message = typeof error === 'string' ? error : error.message;
  const httpStatus = context?.httpStatus;

  // HTTP status-based categorization
  if (httpStatus === 401) return ErrorCategory.AUTH;
  if (httpStatus === 429) return ErrorCategory.RATE_LIMIT;
  if (httpStatus === 408 || httpStatus === 504 || httpStatus === 503) return ErrorCategory.TIMEOUT;

  // Message-based pattern matching
  const lowerMsg = message.toLowerCase();

  if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('econnaborted')
  ) {
    return ErrorCategory.TIMEOUT;
  }

  if (
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('network is unreachable')
  ) {
    return ErrorCategory.NETWORK;
  }

  if (
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('quota') ||
    lowerMsg.includes('too many requests')
  ) {
    return ErrorCategory.RATE_LIMIT;
  }

  if (
    lowerMsg.includes('auth') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('invalid token') ||
    lowerMsg.includes('401')
  ) {
    return ErrorCategory.AUTH;
  }

  if (
    lowerMsg.includes('json') ||
    lowerMsg.includes('parse') ||
    lowerMsg.includes('unexpected') ||
    error instanceof SyntaxError
  ) {
    return ErrorCategory.PARSING;
  }

  if (
    lowerMsg.includes('api key') ||
    lowerMsg.includes('model unavailable') ||
    lowerMsg.includes('service unavailable')
  ) {
    return ErrorCategory.SERVER_LLM;
  }

  if (
    lowerMsg.includes('github') ||
    lowerMsg.includes('external') ||
    lowerMsg.includes('fetch failed')
  ) {
    return ErrorCategory.EXTERNAL_API;
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Format duration for logging (e.g., "123ms", "1.5s")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Server-side metrics recorder
 */
export class ServerMetricsRecorder {
  private metrics: ServerStreamMetrics;

  constructor() {
    this.metrics = {
      requestId: generateRequestId(),
      startTime: Date.now(),
      chunkCount: 0,
      eventCount: 0,
      errorCount: 0,
    };
  }

  getRequestId(): string {
    return this.metrics.requestId;
  }

  setChunkCount(count: number): void {
    this.metrics.chunkCount = count;
  }

  incrementEventCount(): void {
    this.metrics.eventCount++;
  }

  incrementErrorCount(): void {
    this.metrics.errorCount++;
  }

  recordError(error: Error | string, category?: ErrorCategoryType): void {
    this.metrics.errorCategory = category ?? categorizeError(error);
    this.metrics.errorMessage = typeof error === 'string' ? error : error.message;
  }

  end(): ServerStreamMetrics {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    return { ...this.metrics };
  }

  getSnapshot(): ServerStreamMetrics {
    return {
      ...this.metrics,
      endTime: this.metrics.endTime,
      duration: this.metrics.endTime
        ? this.metrics.endTime - this.metrics.startTime
        : undefined,
    };
  }
}

/**
 * Client-side metrics recorder
 */
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
      duration: this.metrics.endTime
        ? this.metrics.endTime - this.metrics.startTime
        : undefined,
    };
  }
}

/**
 * Helper to log metrics in a consistent format
 */
export function logStreamMetrics(label: string, metrics: ServerStreamMetrics | ClientStreamMetrics): void {
  const type = 'duration' in metrics && metrics.duration !== undefined
    ? `[${formatDuration(metrics.duration)}]`
    : '';
  
  const error = metrics.errorCategory ? ` ERROR: ${metrics.errorCategory} - ${metrics.errorMessage}` : '';
  const extra = 'chunkCount' in metrics
    ? ` chunks=${metrics.chunkCount}`
    : ` events=${(metrics as ServerStreamMetrics).eventCount}`;

  console.log(`${label} ${type}${extra}${error}`);
}
