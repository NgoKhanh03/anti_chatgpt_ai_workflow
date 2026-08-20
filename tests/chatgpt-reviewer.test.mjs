import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChatGptReviewerAdapter,
  InvalidReviewResponseError,
  parseReviewResponse,
} from '../dist/adapters/index.js';

const handoff = {
  repository: { owner: 'acme', name: 'demo', defaultBranch: 'main' },
  pullRequest: {
    number: 42,
    title: 'Feature',
    url: 'https://github.com/acme/demo/pull/42',
    headRefName: 'feat/demo',
    baseRefName: 'main',
    headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ciState: 'SUCCESS',
  },
  diff: {
    patch: 'diff --git a/a.ts b/a.ts\n+hello',
    files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
  },
  generatedAt: new Date().toISOString(),
};

class FakeBrowserTransport {
  constructor(response) {
    this.response = response;
    this.requests = [];
  }

  async review(request) {
    this.requests.push(request);
    return this.response;
  }
}

test('parses APPROVE response', () => {
  const result = parseReviewResponse('{"verdict":"APPROVE","issues":[]}');
  assert.equal(result.verdict, 'APPROVE');
  assert.deepEqual(result.issues, []);
});

test('parses fenced REQUEST_CHANGES response', () => {
  const result = parseReviewResponse(`\`\`\`json
{"verdict":"REQUEST_CHANGES","issues":[{"id":"R001","severity":"P1","file":"a.ts","line":1,"problem":"Bug","recommended_fix":"Fix it"}]}
\`\`\``);
  assert.equal(result.verdict, 'REQUEST_CHANGES');
  assert.equal(result.issues[0].id, 'R001');
  assert.equal(result.issues[0].recommendedFix, 'Fix it');
});

test('rejects invalid review contract', () => {
  assert.throws(
    () => parseReviewResponse('{"verdict":"APPROVE","issues":[{"id":"R1","severity":"P1","problem":"Blocking bug"}]}'),
    InvalidReviewResponseError,
  );
});

test('adapter sends structured handoff to browser transport', async () => {
  const transport = new FakeBrowserTransport('{"verdict":"APPROVE","issues":[]}');
  const adapter = new ChatGptReviewerAdapter(transport);
  const result = await adapter.review(handoff);

  assert.equal(result.verdict, 'APPROVE');
  assert.equal(transport.requests.length, 1);
  assert.match(transport.requests[0].handoffMarkdown, /PR: #42/);
  assert.match(transport.requests[0].systemPrompt, /senior independent code reviewer/i);
});
