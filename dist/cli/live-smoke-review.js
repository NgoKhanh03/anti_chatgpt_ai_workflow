import { createReviewer } from '../adapters/reviewer/factory.js';
import { loadReviewerConfig } from '../adapters/reviewer/config.js';
const reviewer = createReviewer(loadReviewerConfig({
    ...process.env,
    REVIEWER_TRANSPORT: 'browser',
    CHATGPT_NEW_CHAT_PER_REVIEW: 'true',
    CHATGPT_TIMEOUT_MS: '120000',
    CHATGPT_SETTLE_MS: '2500',
}));
const handoff = {
    repository: { owner: 'ai-workflow-smoke', name: 'raw-cdp-browser-reviewer' },
    pullRequest: {
        number: 1,
        title: 'Smoke test raw CDP browser reviewer',
        url: 'https://github.com/example/ai-workflow-smoke/pull/1',
        headRefName: 'smoke/raw-cdp',
        baseRefName: 'main',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ciState: 'SUCCESS',
    },
    diff: {
        patch: `diff --git a/sum.ts b/sum.ts\nnew file mode 100644\n--- /dev/null\n+++ b/sum.ts\n@@\n+export function sum(a: number, b: number): number {\n+  return a + b;\n+}\n`,
        files: [{ path: 'sum.ts', additions: 3, deletions: 0, status: 'added' }],
    },
    generatedAt: new Date().toISOString(),
};
console.log('LIVE_SMOKE_START');
const result = await reviewer.review(handoff);
console.log('LIVE_SMOKE_RESULT');
console.log(JSON.stringify(result, null, 2));
