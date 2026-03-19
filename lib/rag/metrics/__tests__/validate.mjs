/**
 * Standalone validation script for Metrics library (Phase 2)
 * Tests core logic without external dependencies
 * Run with: node lib/rag/metrics/__tests__/validate.mjs
 */

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let testCount = 0;
let passCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passCount++;
  } catch (err) {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${colors.red}${err.message}${colors.reset}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, but got ${actual}`
    );
  }
}

function assertMatch(str, pattern, message) {
  if (!pattern.test(str)) {
    throw new Error(
      message || `"${str}" does not match pattern ${pattern}`
    );
  }
}

function assertGreaterThan(actual, expected, message) {
  if (actual <= expected) {
    throw new Error(
      message || `Expected ${actual} > ${expected}`
    );
  }
}

// ============================================================================
// Inline implementations for testing (copied from metrics/index.ts)
// ============================================================================

const ErrorCategory = {
  NETWORK: 'network',
  SERVER_LLM: 'server_llm',
  PARSING: 'parsing',
  TIMEOUT: 'timeout',
  EXTERNAL_API: 'external_api',
  RATE_LIMIT: 'rate_limit',
  AUTH: 'auth',
  UNKNOWN: 'unknown',
};

function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

function generateHeartbeatId() {
  return `hb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function categorizeError(error, context = {}) {
  const message = typeof error === 'string' ? error : error.message || '';
  const httpStatus = context.httpStatus;

  // HTTP status-based categorization
  if (httpStatus === 401) return ErrorCategory.AUTH;
  if (httpStatus === 429) return ErrorCategory.RATE_LIMIT;
  if (httpStatus === 408 || httpStatus === 504 || httpStatus === 503)
    return ErrorCategory.TIMEOUT;

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

function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

class ServerMetricsRecorder {
  constructor() {
    this.metrics = {
      requestId: generateRequestId(),
      startTime: Date.now(),
      chunkCount: 0,
      eventCount: 0,
      errorCount: 0,
    };
  }

  getRequestId() {
    return this.metrics.requestId;
  }

  setChunkCount(count) {
    this.metrics.chunkCount = count;
  }

  incrementEventCount() {
    this.metrics.eventCount++;
  }

  incrementErrorCount() {
    this.metrics.errorCount++;
  }

  recordError(error, category) {
    this.metrics.errorCategory = category ?? categorizeError(error);
    this.metrics.errorMessage =
      typeof error === 'string' ? error : error.message;
  }

  end() {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    return { ...this.metrics };
  }

  getSnapshot() {
    return {
      ...this.metrics,
      endTime: this.metrics.endTime,
      duration: this.metrics.endTime
        ? this.metrics.endTime - this.metrics.startTime
        : undefined,
    };
  }
}

class ClientMetricsRecorder {
  constructor(requestId = generateRequestId()) {
    this.metrics = {
      requestId,
      startTime: Date.now(),
      chunkCount: 0,
      sourceCount: 0,
    };
  }

  getRequestId() {
    return this.metrics.requestId;
  }

  recordFirstByte() {
    if (!this.metrics.firstByteTime) {
      this.metrics.firstByteTime = Date.now();
      this.metrics.ttfb = this.metrics.firstByteTime - this.metrics.startTime;
    }
  }

  recordParseStart() {
    if (!this.metrics.parseStartTime) {
      this.metrics.parseStartTime = Date.now();
    }
  }

  recordParseEnd() {
    if (!this.metrics.parseEndTime) {
      this.metrics.parseEndTime = Date.now();
    }
  }

  incrementChunkCount() {
    this.metrics.chunkCount = (this.metrics.chunkCount ?? 0) + 1;
  }

  setSourceCount(count) {
    this.metrics.sourceCount = count;
  }

  recordError(error, category) {
    this.metrics.errorCategory = category ?? categorizeError(error);
    this.metrics.errorMessage =
      typeof error === 'string' ? error : error.message;
  }

  recordCancelled() {
    this.metrics.cancelled = true;
  }

  end() {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    return { ...this.metrics };
  }

  getSnapshot() {
    return {
      ...this.metrics,
      endTime: this.metrics.endTime,
      duration: this.metrics.endTime
        ? this.metrics.endTime - this.metrics.startTime
        : undefined,
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

console.log(
  `\n${colors.cyan}=== Metrics Library Validation ===${colors.reset}\n`
);

// Test ID Generation
console.log(`${colors.cyan}ID Generation${colors.reset}`);
test('generateRequestId produces unique IDs', () => {
  const id1 = generateRequestId();
  const id2 = generateRequestId();
  assertMatch(id1, /^req_[a-z0-9]+_[a-z0-9]+$/, 'ID format invalid');
  assertMatch(id2, /^req_[a-z0-9]+_[a-z0-9]+$/, 'ID format invalid');
  assert(id1 !== id2, 'IDs should be unique');
});

test('generateHeartbeatId produces valid IDs', () => {
  const id = generateHeartbeatId();
  assertMatch(id, /^hb_\d+_[a-z0-9]+$/, 'Heartbeat ID format invalid');
});

// Test Error Categorization
console.log(`\n${colors.cyan}Error Categorization${colors.reset}`);
test('timeout errors categorized correctly', () => {
  assertEquals(categorizeError('Request timeout'), ErrorCategory.TIMEOUT);
  assertEquals(categorizeError('ECONNABORTED'), ErrorCategory.TIMEOUT);
});

test('network errors categorized correctly', () => {
  assertEquals(categorizeError('ECONNREFUSED'), ErrorCategory.NETWORK);
  assertEquals(categorizeError('ENOTFOUND'), ErrorCategory.NETWORK);
});

test('rate limit errors categorized correctly', () => {
  assertEquals(
    categorizeError('rate limit exceeded'),
    ErrorCategory.RATE_LIMIT
  );
  assertEquals(
    categorizeError('Too many requests', { httpStatus: 429 }),
    ErrorCategory.RATE_LIMIT
  );
});

test('auth errors categorized correctly', () => {
  assertEquals(categorizeError('Unauthorized'), ErrorCategory.AUTH);
  assertEquals(
    categorizeError('invalid token', { httpStatus: 401 }),
    ErrorCategory.AUTH
  );
});

test('parsing errors categorized correctly', () => {
  assertEquals(
    categorizeError(new SyntaxError('Unexpected token')),
    ErrorCategory.PARSING
  );
  assertEquals(categorizeError('JSON parse error'), ErrorCategory.PARSING);
});

test('LLM errors categorized correctly', () => {
  assertEquals(categorizeError('API key invalid'), ErrorCategory.SERVER_LLM);
  assertEquals(
    categorizeError('Model unavailable'),
    ErrorCategory.SERVER_LLM
  );
});

test('unknown errors default correctly', () => {
  assertEquals(categorizeError('Some random error'), ErrorCategory.UNKNOWN);
});

// Test ServerMetricsRecorder
console.log(`\n${colors.cyan}ServerMetricsRecorder${colors.reset}`);
test('initializes with correct defaults', () => {
  const recorder = new ServerMetricsRecorder();
  const snap = recorder.getSnapshot();
  assertMatch(snap.requestId, /^req_/, 'Request ID format invalid');
  assertEquals(snap.chunkCount, 0);
  assertEquals(snap.eventCount, 0);
  assertEquals(snap.errorCount, 0);
  assert(!snap.endTime, 'endTime should be undefined initially');
});

test('tracks chunk count', () => {
  const recorder = new ServerMetricsRecorder();
  recorder.setChunkCount(5);
  assertEquals(recorder.getSnapshot().chunkCount, 5);
});

test('increments event count correctly', () => {
  const recorder = new ServerMetricsRecorder();
  recorder.incrementEventCount();
  recorder.incrementEventCount();
  assertEquals(recorder.getSnapshot().eventCount, 2);
});

test('increments error count correctly', () => {
  const recorder = new ServerMetricsRecorder();
  recorder.incrementErrorCount();
  recorder.incrementErrorCount();
  assertEquals(recorder.getSnapshot().errorCount, 2);
});

test('records error with categorization', () => {
  const recorder = new ServerMetricsRecorder();
  recorder.recordError(new Error('timeout error'));
  const snap = recorder.getSnapshot();
  assertEquals(snap.errorCategory, ErrorCategory.TIMEOUT);
  assertEquals(snap.errorMessage, 'timeout error');
});

test('end() calculates duration', () => {
  const recorder = new ServerMetricsRecorder();
  const before = Date.now();
  // Small delay to ensure time passes
  while (Date.now() === before) {}
  const final = recorder.end();
  assertGreaterThan(final.endTime, final.startTime);
  assertGreaterThan(final.duration, 0);
});

// Test ClientMetricsRecorder
console.log(`\n${colors.cyan}ClientMetricsRecorder${colors.reset}`);
test('initializes with correct defaults', () => {
  const recorder = new ClientMetricsRecorder();
  const snap = recorder.getSnapshot();
  assertMatch(snap.requestId, /^req_/, 'Request ID format invalid');
  assertEquals(snap.chunkCount, 0);
  assertEquals(snap.sourceCount, 0);
  assert(!snap.firstByteTime, 'firstByteTime should be undefined initially');
});

test('accepts custom request ID', () => {
  const customId = 'custom_request_123';
  const recorder = new ClientMetricsRecorder(customId);
  assertEquals(recorder.getRequestId(), customId);
});

test('records first byte (TTFB)', () => {
  const recorder = new ClientMetricsRecorder();
  const before = Date.now();
  while (Date.now() === before) {} // wait for time to advance
  recorder.recordFirstByte();
  const snap = recorder.getSnapshot();
  assertGreaterThan(snap.firstByteTime, snap.startTime, 'firstByteTime should be after startTime');
  // TTFB can be 0 if called immediately in same millisecond
  assert(snap.ttfb >= 0, 'ttfb should be >= 0');
});

test('increments chunk count', () => {
  const recorder = new ClientMetricsRecorder();
  recorder.incrementChunkCount();
  recorder.incrementChunkCount();
  assertEquals(recorder.getSnapshot().chunkCount, 2);
});

test('sets source count', () => {
  const recorder = new ClientMetricsRecorder();
  recorder.setSourceCount(3);
  assertEquals(recorder.getSnapshot().sourceCount, 3);
});

test('records parse lifecycle', () => {
  const recorder = new ClientMetricsRecorder();
  recorder.recordParseStart();
  recorder.recordParseEnd();
  const snap = recorder.getSnapshot();
  assert(snap.parseStartTime > 0, 'parseStartTime should be set');
  assert(
    snap.parseEndTime >= snap.parseStartTime,
    'parseEndTime should be >= parseStartTime'
  );
});

test('records cancellation', () => {
  const recorder = new ClientMetricsRecorder();
  recorder.recordCancelled();
  assertEquals(recorder.getSnapshot().cancelled, true);
});

test('records error with categorization', () => {
  const recorder = new ClientMetricsRecorder();
  recorder.recordError(new Error('rate limit exceeded'));
  const snap = recorder.getSnapshot();
  assertEquals(snap.errorCategory, ErrorCategory.RATE_LIMIT);
});

test('end() calculates duration', () => {
  const recorder = new ClientMetricsRecorder();
  const before = Date.now();
  while (Date.now() === before) {}
  const final = recorder.end();
  assertGreaterThan(final.endTime, final.startTime);
  assertGreaterThan(final.duration, 0);
});

// Test Duration Formatting
console.log(`\n${colors.cyan}Duration Formatting${colors.reset}`);
test('formats milliseconds correctly', () => {
  assertEquals(formatDuration(0), '0ms');
  assertEquals(formatDuration(500), '500ms');
  assertEquals(formatDuration(999), '999ms');
});

test('formats seconds correctly', () => {
  assertEquals(formatDuration(1000), '1.0s');
  assertEquals(formatDuration(1500), '1.5s');
  assertEquals(formatDuration(5000), '5.0s');
});

// Integration Tests
console.log(`\n${colors.cyan}Integration Tests${colors.reset}`);
test('full server metrics lifecycle', () => {
  const recorder = new ServerMetricsRecorder();
  const requestId = recorder.getRequestId();
  recorder.setChunkCount(10);
  for (let i = 0; i < 50; i++) {
    recorder.incrementEventCount();
  }
  recorder.recordError(new Error('temporary glitch'), ErrorCategory.NETWORK);
  recorder.incrementErrorCount();
  const before = Date.now();
  while (Date.now() === before) {} // ensure time advances
  const final = recorder.end();

  assertEquals(final.requestId, requestId);
  assertEquals(final.chunkCount, 10);
  assertEquals(final.eventCount, 50);
  assertEquals(final.errorCount, 1);
  assertEquals(final.errorCategory, ErrorCategory.NETWORK);
  assertGreaterThan(final.duration, -1, 'duration should be >= 0'); // >= 0
});

test('full client metrics lifecycle', () => {
  const recorder = new ClientMetricsRecorder();
  recorder.recordFirstByte();
  recorder.recordParseStart();
  for (let i = 0; i < 25; i++) {
    recorder.incrementChunkCount();
  }
  recorder.setSourceCount(3);
  recorder.recordParseEnd();
  const before = Date.now();
  while (Date.now() === before) {} // ensure time advances
  const final = recorder.end();

  assertGreaterThan(final.ttfb, -1, 'ttfb should be >= 0');
  assertEquals(final.chunkCount, 25);
  assertEquals(final.sourceCount, 3);
  assertGreaterThan(final.duration, -1, 'duration should be >= 0'); // >= 0
  assert(final.parseStartTime > 0, 'parseStartTime should be set');
  assert(final.parseEndTime > 0, 'parseEndTime should be set');
});

// Summary
console.log(`\n${colors.cyan}=== Summary ===${colors.reset}`);
console.log(
  `${passCount === testCount ? colors.green : colors.red}${passCount}/${testCount} tests passed${colors.reset}`
);

if (passCount === testCount) {
  console.log(
    `\n${colors.green}✓ All validation tests passed!${colors.reset}\n`
  );
  process.exit(0);
} else {
  console.log(
    `\n${colors.red}✗ ${testCount - passCount} test(s) failed${colors.reset}\n`
  );
  process.exit(1);
}

