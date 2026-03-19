#!/usr/bin/env node

/*
 * Simple validation script for SSE parsing logic (Phase 4 unit tests)
 * Run with: node src/features/rag/api/__tests__/sseParser.validate.mjs
 */

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

function assertDeepEqual(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(msg || `${sa} !== ${sb}`);
}

// SSE parser logic (same as askRepoStream parsing)
class SSEParser {
  constructor() {
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();

    const events = [];
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr) continue;

      if (dataStr === '[DONE]') {
        events.push({ type: 'done' });
        continue;
      }

      try {
        const event = JSON.parse(dataStr);
        events.push({ type: 'event', payload: event });
      } catch {
        // ignore malformed JSON (fragmented or bad)
      }
    }
    return events;
  }
}

console.log(`\n${colors.cyan}SSE Parser Validation${colors.reset}\n`);

test('parses a single complete event', () => {
  const parser = new SSEParser();
  const events = parser.push('data: {"type":"delta","content":"a"}\n\n');
  assertDeepEqual(events, [
    { type: 'event', payload: { type: 'delta', content: 'a' } },
  ]);
});

test('handles fragmented input across chunks', () => {
  const parser = new SSEParser();
  const part1 = 'data: {"type":"delta"';
  const part2 = ',"content":"a"}\n';

  const events1 = parser.push(part1);
  assertDeepEqual(events1, []);

  const events2 = parser.push(part2);
  assertDeepEqual(events2, [
    { type: 'event', payload: { type: 'delta', content: 'a' } },
  ]);
});

test('ignores malformed JSON lines', () => {
  const parser = new SSEParser();
  const events = parser.push('data: {bad json}\n\n');
  assertDeepEqual(events, []);
});

test('detects DONE marker', () => {
  const parser = new SSEParser();
  const events = parser.push('data: [DONE]\n\n');
  assertDeepEqual(events, [{ type: 'done' }]);
});

console.log(`\n${colors.cyan}Summary${colors.reset}`);
console.log(`${passed}/${total} tests passed`);
if (passed !== total) process.exit(1);
process.exit(0);
