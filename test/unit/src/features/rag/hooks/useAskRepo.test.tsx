// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockAskRepoStream, mockSubmitEvalFeedback } = vi.hoisted(() => ({
  mockAskRepoStream: vi.fn(),
  mockSubmitEvalFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../../src/features/rag/api/rag.js', () => ({
  askRepoStream: mockAskRepoStream,
  submitEvalFeedback: mockSubmitEvalFeedback,
}));

import { useAskRepo } from '../../../../../../src/features/rag/hooks/useAskRepo.js';

type HookApi = ReturnType<typeof useAskRepo>;

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useAskRepo requestId lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let api: HookApi | null;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    api = null;
    localStorage.clear();
    vi.clearAllMocks();

    function Harness() {
      api = useAskRepo('owner/repo');
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    queryClient.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('clears the live requestId when showing a cached history answer', async () => {
    mockAskRepoStream.mockImplementation(async (_repo, _question, _token, options) => {
      options.onMetrics?.({ requestId: 'req_live', startTime: Date.now() });
      options.onDelta?.('live answer', 1);
      options.onSources?.([]);
      options.onStatus?.('streaming');
      options.onStatus?.('done');
    });

    await act(async () => {
      api!.ask('Where is the code?');
      await flush();
    });

    expect(api!.getRequestId()).toBe('req_live');

    await act(async () => {
      api!.showCached({ answer: 'cached answer', sources: [] });
      await flush();
    });

    expect(api!.getRequestId()).toBeNull();

    await act(async () => {
      api!.sendThumbsUp();
      await flush();
    });

    expect(mockSubmitEvalFeedback).not.toHaveBeenCalled();
  });

  it('clears the previous requestId when a local cached answer short-circuits a repeat ask', async () => {
    mockAskRepoStream.mockImplementation(async (_repo, _question, _token, options) => {
      options.onMetrics?.({ requestId: 'req_live', startTime: Date.now() });
      options.onDelta?.('live answer', 1);
      options.onSources?.([]);
      options.onStatus?.('streaming');
      options.onStatus?.('done');
    });

    await act(async () => {
      api!.ask('Repeatable question');
      await flush();
    });

    expect(api!.getRequestId()).toBe('req_live');

    await act(async () => {
      api!.ask('Repeatable question');
      await flush();
    });

    expect(api!.getRequestId()).toBeNull();

    await act(async () => {
      api!.sendThumbsDown();
      await flush();
    });

    expect(mockAskRepoStream).toHaveBeenCalledTimes(1);
    expect(mockSubmitEvalFeedback).not.toHaveBeenCalled();
  });
});
