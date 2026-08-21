import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversationUrl,
  buildBrowserReviewPrompt,
  extractConversationId,
  isNewAssistantResponse,
  loadReviewerConfig,
} from '../dist/adapters/index.js';

const request = {
  systemPrompt: 'You are reviewer.',
  handoff: {
    repository: { owner: 'acme', name: 'demo' },
    pullRequest: {
      number: 8,
      title: 'Browser review',
      url: 'https://github.com/acme/demo/pull/8',
      headRefName: 'feat/browser',
      baseRefName: 'main',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ciState: 'SUCCESS',
    },
    diff: { patch: 'diff', files: [] },
    generatedAt: new Date().toISOString(),
  },
  handoffMarkdown: '# PR Review Handoff\nPR: #8',
};

test('browser reviewer config is default and needs no API key', () => {
  const config = loadReviewerConfig({});
  assert.equal(config.transport, 'browser');
  assert.equal(config.browser.cdpUrl, undefined);
  assert.equal(config.browser.newChatPerReview, true);
  assert.equal(config.browser.timeoutMs, 300000);
  assert.equal(config.browser.agentRequestTimeoutMs, 315000);
  assert.equal(config.openai.apiKey, undefined);
});

test('builds strict browser review prompt with PR handoff', () => {
  const prompt = buildBrowserReviewPrompt(request);
  assert.match(prompt, /You are reviewer/);
  assert.match(prompt, /Return the Review Contract JSON only/);
  assert.match(prompt, /PR: #8/);
});

test('includes project overview and progress in the review prompt', () => {
  const prompt = buildBrowserReviewPrompt({
    ...request,
    projectContext: {
      projectId: 'acme/demo',
      overview: 'Project overview text',
      progress: 'Project progress text',
    },
  });
  assert.match(prompt, /Project ID: acme\/demo/);
  assert.match(prompt, /Project overview text/);
  assert.match(prompt, /Project progress text/);
});

test('builds and extracts a project conversation URL', () => {
  const url = buildConversationUrl('https://chatgpt.com/', 'abc-123');
  assert.equal(url, 'https://chatgpt.com/c/abc-123');
  assert.equal(extractConversationId(url), 'abc-123');
  assert.equal(extractConversationId('https://chatgpt.com/'), undefined);
});

test('detects a new response when a reused conversation virtualizes message nodes', () => {
  assert.equal(isNewAssistantResponse(4, 'old response', 4, 'new response'), true);
  assert.equal(isNewAssistantResponse(4, 'old response', 4, 'old response'), false);
});
