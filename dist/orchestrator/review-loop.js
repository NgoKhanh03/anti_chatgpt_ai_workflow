import { deterministicChecksPassed, hasCommit, } from '../adapters/antigravity/index.js';
import { CiWaitTimeoutError } from '../github/index.js';
import { assertApprovalCurrent, createApprovalEvidence } from '../review/index.js';
import { transition } from './workflow-state.js';
function isBlocking(issue) {
    return issue.severity === 'P0' || issue.severity === 'P1';
}
export class ReviewLoopCoordinator {
    github;
    reviewer;
    cleanRoomReviewer;
    antigravity;
    stateStore;
    policy;
    constructor(github, reviewer, cleanRoomReviewer, antigravity, stateStore, policy) {
        this.github = github;
        this.reviewer = reviewer;
        this.cleanRoomReviewer = cleanRoomReviewer;
        this.antigravity = antigravity;
        this.stateStore = stateStore;
        this.policy = policy;
        if (!Number.isInteger(policy.maxIterations) || policy.maxIterations <= 0) {
            throw new Error('Review loop maxIterations must be a positive integer.');
        }
    }
    async persist(state) {
        await this.stateStore.save(state);
    }
    syncIssues(state, review) {
        const currentIds = new Set(review.issues.map((issue) => issue.id));
        for (const [id, issue] of Object.entries(state.issues)) {
            if (issue.status === 'FIXED' && !currentIds.has(id)) {
                issue.status = 'VERIFIED';
            }
        }
        for (const issue of review.issues) {
            const previous = state.issues[issue.id];
            state.issues[issue.id] = {
                id: issue.id,
                severity: issue.severity,
                status: previous?.status === 'FIXED' ? 'OPEN' : previous?.status ?? 'OPEN',
                problem: issue.problem,
                recommendedFix: issue.recommendedFix,
            };
        }
    }
    markBlockingIssuesFixed(state, review) {
        for (const issue of review.issues.filter(isBlocking)) {
            const tracked = state.issues[issue.id];
            if (tracked)
                tracked.status = 'FIXED';
        }
    }
    async handleCiState(state, ciState) {
        if (ciState === 'SUCCESS')
            return undefined;
        if (ciState === 'FAILURE') {
            state.state = transition(state.state, 'FIXING');
        }
        else if (ciState === 'UNKNOWN') {
            state.state = transition(state.state, 'NEEDS_HUMAN');
        }
        await this.persist(state);
        return { state: state.state, iteration: state.iteration };
    }
    async fixBlockingIssues(state, task, review) {
        const blocking = review.issues.filter(isBlocking);
        state.state = transition(state.state, 'FIXING');
        await this.persist(state);
        const execution = await this.antigravity.fix(task, blocking.map((issue) => ({
            id: issue.id,
            severity: issue.severity,
            problem: issue.problem,
            recommendedFix: issue.recommendedFix,
        })));
        const readyForReview = deterministicChecksPassed(execution) && hasCommit(execution);
        if (readyForReview) {
            if (this.github.pushBranch) {
                if (!execution.branch)
                    throw new Error('Antigravity fix did not report the current branch.');
                await this.github.pushBranch(execution.branch);
            }
            this.markBlockingIssuesFixed(state, review);
        }
        state.state = transition(state.state, 'TESTING');
        if (!readyForReview) {
            state.state = transition(state.state, 'FIXING');
        }
        await this.persist(state);
        return readyForReview;
    }
    async createCiCheckedHandoff(state, prNumber) {
        try {
            await this.github.waitForCi?.(prNumber, {
                timeoutMs: this.policy.ciTimeoutMs ?? 15 * 60_000,
                pollIntervalMs: this.policy.ciPollIntervalMs ?? 10_000,
            });
        }
        catch (error) {
            if (!(error instanceof CiWaitTimeoutError))
                throw error;
            state.state = transition(state.state, 'NEEDS_HUMAN');
            await this.persist(state);
            return undefined;
        }
        return this.github.createHandoffPacket(prNumber);
    }
    async publishReview(prNumber, phase, iteration, headSha, review) {
        await this.github.publishReviewComment?.(prNumber, {
            phase,
            iteration,
            headSha,
            verdict: review.verdict,
            issues: review.issues,
        });
    }
    async fixCiFailure(state, task, prNumber, headSha, phase) {
        const review = {
            verdict: 'REQUEST_CHANGES',
            issues: [{
                    id: `CI-${headSha.slice(0, 12)}`,
                    severity: 'P1',
                    problem: 'GitHub CI failed for the current PR head. Inspect the failing checks and logs, then fix the root cause.',
                    recommendedFix: `Use gh pr checks ${prNumber} and the relevant gh run logs before changing code.`,
                }],
        };
        state.iteration += 1;
        this.syncIssues(state, review);
        await this.persist(state);
        await this.publishReview(prNumber, phase, state.iteration, headSha, review);
        return this.fixBlockingIssues(state, task, review);
    }
    async runCleanRoomReview(state, task, prNumber, context) {
        const cleanHandoff = await this.createCiCheckedHandoff(state, prNumber);
        if (!cleanHandoff)
            return { state: state.state, iteration: state.iteration };
        if (cleanHandoff.pullRequest.ciState === 'FAILURE' && this.github.pushBranch) {
            const fixed = await this.fixCiFailure(state, task, prNumber, cleanHandoff.pullRequest.headSha, 'clean-room');
            if (!fixed)
                return { state: state.state, iteration: state.iteration };
            return undefined;
        }
        const ciResult = await this.handleCiState(state, cleanHandoff.pullRequest.ciState);
        if (ciResult)
            return ciResult;
        const finalReview = await this.cleanRoomReviewer.review(cleanHandoff, undefined, context?.cleanRoomProject);
        this.syncIssues(state, finalReview);
        await this.publishReview(prNumber, 'clean-room', state.iteration, cleanHandoff.pullRequest.headSha, finalReview);
        const finalBlocking = finalReview.issues.filter(isBlocking);
        if (finalBlocking.length > 0) {
            const fixed = await this.fixBlockingIssues(state, task, finalReview);
            if (!fixed) {
                return {
                    state: state.state,
                    iteration: state.iteration,
                    review: finalReview,
                };
            }
            return undefined;
        }
        state.state = transition(state.state, 'AI_APPROVED');
        state.approval = createApprovalEvidence(cleanHandoff);
        state.state = transition(state.state, 'HUMAN_APPROVAL');
        await this.persist(state);
        return {
            state: state.state,
            iteration: state.iteration,
            review: finalReview,
        };
    }
    async run(task, prNumber, context) {
        const state = await this.stateStore.load();
        state.prNumber = prNumber;
        if (state.state === 'HUMAN_APPROVAL' || state.state === 'NEEDS_HUMAN' || state.state === 'MERGED') {
            await this.persist(state);
            return { state: state.state, iteration: state.iteration };
        }
        if (state.state === 'AI_APPROVED') {
            state.state = transition(state.state, 'HUMAN_APPROVAL');
            await this.persist(state);
            return { state: state.state, iteration: state.iteration };
        }
        if (state.state === 'FIXING') {
            await this.persist(state);
            return { state: state.state, iteration: state.iteration };
        }
        if (state.state === 'NEW' || state.state === 'CODING') {
            throw new Error(`Review loop cannot start from ${state.state}; a tested pull request is required.`);
        }
        if (state.state === 'FINAL_REVIEW') {
            const resumedFinalReview = await this.runCleanRoomReview(state, task, prNumber, context);
            if (resumedFinalReview)
                return resumedFinalReview;
        }
        while (state.iteration < this.policy.maxIterations) {
            if (state.state === 'PR_CREATED') {
                state.state = transition(state.state, 'AI_REVIEWING');
            }
            else if (state.state === 'TESTING') {
                state.state = transition(state.state, 'PR_CREATED');
                state.state = transition(state.state, 'AI_REVIEWING');
            }
            await this.persist(state);
            const handoff = await this.createCiCheckedHandoff(state, prNumber);
            if (!handoff)
                return { state: state.state, iteration: state.iteration };
            if (handoff.pullRequest.ciState === 'FAILURE' && this.github.pushBranch) {
                const fixed = await this.fixCiFailure(state, task, prNumber, handoff.pullRequest.headSha, 'review');
                if (!fixed)
                    return { state: state.state, iteration: state.iteration };
                continue;
            }
            const ciResult = await this.handleCiState(state, handoff.pullRequest.ciState);
            if (ciResult)
                return ciResult;
            const review = await this.reviewer.review(handoff, undefined, context?.project);
            state.approval = undefined;
            state.iteration += 1;
            this.syncIssues(state, review);
            await this.persist(state);
            await this.publishReview(prNumber, 'review', state.iteration, handoff.pullRequest.headSha, review);
            const blocking = review.issues.filter(isBlocking);
            if (blocking.length > 0) {
                const fixed = await this.fixBlockingIssues(state, task, review);
                if (!fixed) {
                    return {
                        state: state.state,
                        iteration: state.iteration,
                        review,
                    };
                }
                continue;
            }
            state.state = transition(state.state, 'FINAL_REVIEW');
            await this.persist(state);
            const finalResult = await this.runCleanRoomReview(state, task, prNumber, context);
            if (finalResult)
                return finalResult;
        }
        state.state = transition(state.state, 'NEEDS_HUMAN');
        await this.persist(state);
        return { state: state.state, iteration: state.iteration };
    }
    async approveMerge() {
        const state = await this.stateStore.load();
        if (state.state !== 'HUMAN_APPROVAL') {
            throw new Error(`Merge approval requires HUMAN_APPROVAL state, got ${state.state}.`);
        }
        if (!state.approval || state.prNumber === undefined) {
            throw new Error('Merge approval requires immutable review evidence.');
        }
        const currentHandoff = await this.github.createHandoffPacket(state.prNumber);
        assertApprovalCurrent(state.approval, currentHandoff);
        state.state = transition(state.state, 'MERGED');
        await this.persist(state);
        return state;
    }
}
