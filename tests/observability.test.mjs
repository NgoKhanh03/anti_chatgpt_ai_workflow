import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACTED,
  RunMetrics,
  StructuredLogger,
  isTransientError,
  redactValue,
  withRetry,
} from '../dist/observability/index.js';

test('redacts secrets recursively', () => {
  const value = redactValue({
    apiKey: 'sk-super-secret-value',
    nested: {
      authorization: 'Bearer abc.def.ghi',
      safe: 'visible',
    },
  });
  assert.equal(value.apiKey, REDACTED);
  assert.equal(value.nested.authorization, REDACTED);
  assert.equal(value.nested.safe, 'visible');
});

test('structured logger emits JSON with redacted data', () => {
  const lines = [];
  const logger = new StructuredLogger((line) => lines.push(line), { runId: 'run-1' });
  logger.info('test.event', { token: 'secret-token', safe: 42 });
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, 'test.event');
  assert.equal(record.runId, 'run-1');
  assert.equal(record.data.token, REDACTED);
  assert.equal(record.data.safe, 42);
});

test('retry retries transient failures only', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('rate limit'), { status: 429 });
    return 'ok';
  }, {
    maxAttempts: 3,
    baseDelayMs: 0,
    sleep: async () => {},
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.equal(isTransientError({ status: 429 }), true);
  assert.equal(isTransientError({ status: 400 }), false);
});

test('run metrics capture counters and outcome', () => {
  const metrics = new RunMetrics('run-1', 'TASK-1', 42);
  metrics.incrementIteration();
  metrics.incrementReviewerCalls();
  metrics.incrementAntigravityCalls();
  metrics.incrementRetries();
  const snapshot = metrics.finish('HUMAN_APPROVAL');
  assert.equal(snapshot.iterations, 1);
  assert.equal(snapshot.reviewerCalls, 1);
  assert.equal(snapshot.antigravityCalls, 1);
  assert.equal(snapshot.retries, 1);
  assert.equal(snapshot.outcome, 'HUMAN_APPROVAL');
  assert.ok(snapshot.durationMs >= 0);
});
