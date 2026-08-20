import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrowserReviewPrompt,
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
  assert.equal(config.openai.apiKey, undefined);
});

test('builds strict browser review prompt with PR handoff', () => {
  const prompt = buildBrowserReviewPrompt(request);
  assert.match(prompt, /You are reviewer/);
  assert.match(prompt, /Return the Review Contract JSON only/);
  assert.match(prompt, /PR: #8/);
});
