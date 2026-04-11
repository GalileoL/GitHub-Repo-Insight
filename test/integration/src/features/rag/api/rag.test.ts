import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askRepoStream, categorizeError, ClientMetricsRecorder, ErrorCategory } from '../../../../../../src/features/rag/api/rag';

function createReadableStreamFromStrings(strings: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= strings.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(strings[i]));
      i += 1;
    },
  });
}

describe('askRepoStream', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('parses delta events and calls callbacks', async () => {
    const stream = createReadableStreamFromStrings([
      'data: {"type":"delta","seq":1,"content":"hello"}\n\n',
      'data: [DONE]\n\n',
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'req-123' },
      body: stream,
    })) as unknown as typeof globalThis.fetch;

    const received: string[] = [];
    const statuses: string[] = [];
    const metrics: Array<ReturnType<ClientMetricsRecorder['getSnapshot']>> = [];

    await askRepoStream('o/r', 'q', 'token', {
      onDelta: (delta, seq) => {
        received.push(delta);
        expect(seq).toBe(1);
      },
      onStatus: (status) => {
        statuses.push(status);
      },
      onMetrics: (m) => {
        metrics.push(m);
      },
    });

    expect(received).toEqual(['hello']);
    expect(statuses).toEqual(['connecting', 'streaming', 'done']);
    expect(metrics[metrics.length - 1].chunkCount).toBe(1);
  });

  it('continues on malformed lines and does not throw', async () => {
    const stream = createReadableStreamFromStrings([
      'data: {"type":"delta","seq":1,"content":"good"}\n\n',
      'data: {"type":"delta","seq":2,"content":"bad"\n\n',
      'data: [DONE]\n\n',
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'req-123' },
      body: stream,
    })) as unknown as typeof globalThis.fetch;

    const received: string[] = [];

    await askRepoStream('o/r', 'q', 'token', {
      onDelta: (delta) => {
        received.push(delta);
      },
    });

    expect(received).toEqual(['good']);
  });

  it('reports errors when server sends error event', async () => {
    const stream = createReadableStreamFromStrings([
      'data: {"type":"error","message":"boom"}\n\n',
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'req-123' },
      body: stream,
    })) as unknown as typeof globalThis.fetch;

    const errors: string[] = [];

    await expect(
      askRepoStream('o/r', 'q', 'token', {
        onError: (err) => errors.push(err),
      }),
    ).rejects.toThrow('boom');

    expect(errors[0]).toBe('boom');
  });
});

describe('categorizeError', () => {
  it('categorizes timeout errors correctly', () => {
    expect(categorizeError(new Error('Request timed out'))).toBe(ErrorCategory.TIMEOUT);
  });

  it('categorizes network errors correctly', () => {
    expect(categorizeError(new Error('network failure'))).toBe(ErrorCategory.NETWORK);
  });

  it('categorizes auth errors correctly', () => {
    expect(categorizeError(new Error('Unauthorized'), { httpStatus: 401 })).toBe(ErrorCategory.AUTH);
  });
});

describe('ClientMetricsRecorder', () => {
  it('records timing and counts', () => {
    const recorder = new ClientMetricsRecorder('test');
    recorder.recordFirstByte();
    recorder.incrementChunkCount();
    recorder.recordParseEnd();
    const snapshot = recorder.getSnapshot();

    expect(snapshot.requestId).toBe('test');
    expect(snapshot.chunkCount).toBe(1);
    expect(snapshot.ttfb).toBeGreaterThanOrEqual(0);
  });
});
