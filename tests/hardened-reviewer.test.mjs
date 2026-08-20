import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HardenedReviewerTransport,
  RunMetrics,
  StructuredLogger,
} from '../dist/observability/index.js';

const request = {
  systemPrompt: 'Review',
  handoffMarkdown: '# PR',
  handoff: {
    repository: { owner: 'acme', name: 'demo' },
    pullRequest: {
      number: 7,
      title: 'Demo',
      url: 'https://github.com/acme/demo/pull/7',
      headRefName: 'feat/demo',
      baseRefName: 'main',
      ciState: 'SUCCESS',
    },
    diff: { patch: 'diff', files: [] },
    generatedAt: new Date().toISOString(),
  },
};

class FlakyTransport {
  constructor() { this.calls = 0; }
  async review() {
    this.calls += 1;
    if (this.calls === 1) throw Object.assign(new Error('temporary'), { status: 503 });
    return '{"verdict":"APPROVE","issues":[]}';
  }
}

test('hardened reviewer retries transient failure and records telemetry', async () => {
  const inner = new FlakyTransport();
  const lines = [];
  const metrics = new RunMetrics('run-reviewer');
  const logger = new StructuredLogger((line) => lines.push(line), { runId: 'run-reviewer' });
  const transport = new HardenedReviewerTransport(inner, logger, metrics, {
    maxAttempts: 2,
    baseDelayMs: 0,
    sleep: async () => {},
  });

  const result = await transport.review(request);
  assert.match(result, /APPROVE/);
  assert.equal(inner.calls, 2);
  assert.equal(metrics.snapshot().reviewerCalls, 1);
  assert.equal(metrics.snapshot().retries, 1);
  assert.ok(lines.some((line) => JSON.parse(line).event === 'reviewer.retry'));
});
