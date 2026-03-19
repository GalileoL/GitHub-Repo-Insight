#!/usr/bin/env node

/*
 * Validation script for askRepoStream resume behavior.
 * Run with: node src/features/rag/api/__tests__/askRepoStream.resume.validate.mjs
 */

import { askRepoStream } from '../rag.ts';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

let passed = 0;
let total = 0;

function test(name, fn) {
  total += 1;
  try {
    fn();
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.error(err);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function createSSEStream(events, delayMs = 0) {
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx >= events.length) {
        controller.close();
        return;
      }
      const chunk = `${events[idx++]}`;
      controller.enqueue(new TextEncoder().encode(chunk));
      if (delayMs > 0) {
        return new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    },
  });
}

function makeFetch(requestId, events) {
  return async () => {
    return {
      ok: true,
      headers: {
        get: (name) => (name.toLowerCase() === 'x-request-id' ? requestId : null),
      },
      body: createSSEStream(events),
    };
  };
}

console.log(`\n${colors.cyan}askRepoStream Resume Validation${colors.reset}\n`);

test('askRepoStream can resume from lastSeq', async () => {
  const requestId = 'test-req-123';
  const events = [
    `data: ${JSON.stringify({ type: 'meta', requestId })}\n\n`,
    `data: ${JSON.stringify({ type: 'delta', seq: 1, content: 'a' })}\n\n`,
    `data: ${JSON.stringify({ type: 'delta', seq: 2, content: 'b' })}\n\n`,
    `data: [DONE]\n\n`,
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetch(requestId, events);

  const received = [];
  let receivedReqId = '';

  await askRepoStream('owner/repo', 'question', 'token', {
    signal: new AbortController().signal,
    onDelta: (content, seq) => {
      received.push(`${seq}:${content}`);
    },
    onSources: () => {},
    onError: (e) => {
      throw new Error(`unexpected error: ${e}`);
    },
    onStatus: () => {},
    onMetrics: (metrics) => {
      receivedReqId = metrics.requestId;
    },
  });

  assert(receivedReqId === requestId, 'should capture requestId from server header');
  assert(received.includes('1:a'), 'should receive first delta');
  assert(received.includes('2:b'), 'should receive second delta');

  // Now resume and ensure it skips seq 1
  const events2 = [
    `data: ${JSON.stringify({ type: 'meta', requestId })}\n\n`,
    `data: ${JSON.stringify({ type: 'delta', seq: 1, content: 'a' })}\n\n`,
    `data: ${JSON.stringify({ type: 'delta', seq: 2, content: 'b' })}\n\n`,
    `data: ${JSON.stringify({ type: 'delta', seq: 3, content: 'c' })}\n\n`,
    `data: [DONE]\n\n`,
  ];

  globalThis.fetch = makeFetch(requestId, events2);

  const received2 = [];
  await askRepoStream('owner/repo', 'question', 'token', {
    signal: new AbortController().signal,
    resume: true,
    requestId,
    lastSeq: 1,
    onDelta: (content, seq) => {
      received2.push(`${seq}:${content}`);
    },
    onSources: () => {},
    onError: (e) => {
      throw new Error(`unexpected error: ${e}`);
    },
    onStatus: () => {},
    onMetrics: () => {},
  });

  assert(!received2.some((r) => r.startsWith('1:')), 'should skip seq 1 when resuming');
  assert(received2.some((r) => r.startsWith('2:')), 'should include seq 2 when resuming');
  assert(received2.some((r) => r.startsWith('3:')), 'should include new seq 3 when resuming');

  globalThis.fetch = originalFetch;
});

console.log(`\n${colors.cyan}Summary${colors.reset}`);
console.log(`${passed}/${total} tests passed`);
if (passed !== total) process.exit(1);
process.exit(0);
