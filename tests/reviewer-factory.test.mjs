import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReviewer,
  loadReviewerConfig,
  OpenAiApiTransport,
} from '../dist/adapters/index.js';

const handoff = {
  repository: { owner: 'acme', name: 'demo' },
  pullRequest: {
    number: 10,
    title: 'API migration',
    url: 'https://github.com/acme/demo/pull/10',
    headRefName: 'feat/api',
    baseRefName: 'main',
    ciState: 'SUCCESS',
  },
  diff: { patch: 'diff', files: [] },
  generatedAt: new Date().toISOString(),
};

class FakeTransport {
  async review() {
    return '{"verdict":"APPROVE","issues":[]}';
  }
}

class FakeOpenAiClient {
  constructor() {
    this.requests = [];
  }
  async createResponse(request) {
    this.requests.push(request);
    return '{"verdict":"APPROVE","issues":[]}';
  }
}

test('loads browser reviewer config by default', () => {
  const config = loadReviewerConfig({});
  assert.equal(config.transport, 'browser');
});

test('loads openai reviewer config from env', () => {
  const config = loadReviewerConfig({
    REVIEWER_TRANSPORT: 'openai',
    OPENAI_API_KEY: 'test-key',
    OPENAI_REVIEW_MODEL: 'review-model',
    OPENAI_BASE_URL: 'https://example.test/v1',
  });
  assert.equal(config.transport, 'openai');
  assert.equal(config.openai.model, 'review-model');
});

test('factory can select browser transport', async () => {
  const reviewer = createReviewer(
    { transport: 'browser' },
    { browserTransport: new FakeTransport() },
  );
  const result = await reviewer.review(handoff);
  assert.equal(result.verdict, 'APPROVE');
});

test('factory can select openai transport', async () => {
  const reviewer = createReviewer(
    {
      transport: 'openai',
      openai: {
        apiKey: 'test-key',
        model: 'review-model',
        baseUrl: 'https://example.test/v1',
      },
    },
    { openaiTransport: new FakeTransport() },
  );
  const result = await reviewer.review(handoff);
  assert.equal(result.verdict, 'APPROVE');
});

test('OpenAiApiTransport forwards prompt and handoff to client', async () => {
  const client = new FakeOpenAiClient();
  const transport = new OpenAiApiTransport(client, 'review-model');
  const raw = await transport.review({
    systemPrompt: 'Review carefully',
    handoff,
    handoffMarkdown: '# PR Review Handoff',
  });

  assert.match(raw, /APPROVE/);
  assert.equal(client.requests[0].model, 'review-model');
  assert.equal(client.requests[0].instructions, 'Review carefully');
  assert.equal(client.requests[0].input, '# PR Review Handoff');
});
