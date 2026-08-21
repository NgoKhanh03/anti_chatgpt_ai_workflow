import process from 'node:process';
import { createReviewer } from '../adapters/reviewer/factory.js';
import { loadReviewerConfig } from '../adapters/reviewer/config.js';
import { GitHubClient, NodeCommandRunner } from '../github/index.js';
import { loadProjectReviewContext } from '../planning/index.js';
function valueAfter(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
const prValue = valueAfter('--pr');
if (!prValue || !/^\d+$/.test(prValue)) {
    throw new Error('Usage: npm run review:pr -- --pr <number> [--project-id <id>] [--overview-file <path>] [--progress-file <path>] [--new-conversation]');
}
const cwd = process.cwd();
const github = new GitHubClient(new NodeCommandRunner(), cwd);
const handoff = await github.createHandoffPacket(Number.parseInt(prValue, 10));
const projectId = valueAfter('--project-id') ?? `${handoff.repository.owner}/${handoff.repository.name}`;
const projectContext = await loadProjectReviewContext({
    projectId,
    root: cwd,
    overviewFile: valueAfter('--overview-file') ?? 'README.md',
    progressFile: valueAfter('--progress-file') ?? 'PROJECT_PROGRESS.md',
});
projectContext.forceNewConversation = process.argv.includes('--new-conversation');
const reviewer = createReviewer(loadReviewerConfig());
const result = await reviewer.review(handoff, undefined, projectContext);
console.log(JSON.stringify({ projectId, prNumber: handoff.pullRequest.number, result }, null, 2));
