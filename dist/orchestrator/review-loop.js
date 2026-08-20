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
    async run(task, prNumber) {
        const state = await this.stateStore.load();
        state.prNumber = prNumber;
        while (state.iteration < this.policy.maxIterations) {
            if (state.state === 'PR_CREATED') {
                state.state = transition(state.state, 'AI_REVIEWING');
            }
            else if (state.state === 'TESTING') {
                state.state = transition(state.state, 'PR_CREATED');
                state.state = transition(state.state, 'AI_REVIEWING');
            }
            await this.persist(state);
            const handoff = await this.github.createHandoffPacket(prNumber);
            if (handoff.pullRequest.ciState !== 'SUCCESS') {
                state.state = 'NEEDS_HUMAN';
                await this.persist(state);
                return { state: state.state, iteration: state.iteration };
            }
            const review = await this.reviewer.review(handoff);
            state.iteration += 1;
            this.syncIssues(state, review);
            await this.persist(state);
            const blocking = review.issues.filter(isBlocking);
            if (review.verdict === 'REQUEST_CHANGES' && blocking.length > 0) {
                state.state = transition(state.state, 'FIXING');
                await this.persist(state);
                const execution = await this.antigravity.fix(task, blocking.map((issue) => ({
                    id: issue.id,
                    severity: issue.severity,
                    problem: issue.problem,
                    recommendedFix: issue.recommendedFix,
                })));
                this.markBlockingIssuesFixed(state, review);
                state.state = transition(state.state, 'TESTING');
                await this.persist(state);
                const allPassed = execution.success &&
                    Object.values(execution.checks).every((status) => status === 'PASS');
                if (!allPassed) {
                    state.state = transition(state.state, 'FIXING');
                    await this.persist(state);
                    continue;
                }
                continue;
            }
            if (review.verdict === 'APPROVE') {
                state.state = transition(state.state, 'FINAL_REVIEW');
                await this.persist(state);
                const cleanHandoff = await this.github.createHandoffPacket(prNumber);
                const finalReview = await this.cleanRoomReviewer.review(cleanHandoff);
                this.syncIssues(state, finalReview);
                const finalBlocking = finalReview.issues.filter(isBlocking);
                if (finalReview.verdict === 'REQUEST_CHANGES' && finalBlocking.length > 0) {
                    state.state = transition(state.state, 'FIXING');
                    await this.persist(state);
                    const execution = await this.antigravity.fix(task, finalBlocking.map((issue) => ({
                        id: issue.id,
                        severity: issue.severity,
                        problem: issue.problem,
                        recommendedFix: issue.recommendedFix,
                    })));
                    this.markBlockingIssuesFixed(state, finalReview);
                    state.state = transition(state.state, 'TESTING');
                    await this.persist(state);
                    const allPassed = execution.success &&
                        Object.values(execution.checks).every((status) => status === 'PASS');
                    if (!allPassed) {
                        state.state = transition(state.state, 'FIXING');
                        await this.persist(state);
                    }
                    continue;
                }
                state.state = transition(state.state, 'AI_APPROVED');
                state.state = transition(state.state, 'HUMAN_APPROVAL');
                await this.persist(state);
                return {
                    state: state.state,
                    iteration: state.iteration,
                    review: finalReview,
                };
            }
        }
        state.state = 'NEEDS_HUMAN';
        await this.persist(state);
        return { state: state.state, iteration: state.iteration };
    }
    async approveMerge() {
        const state = await this.stateStore.load();
        if (state.state !== 'HUMAN_APPROVAL') {
            throw new Error(`Merge approval requires HUMAN_APPROVAL state, got ${state.state}.`);
        }
        state.state = transition(state.state, 'MERGED');
        await this.persist(state);
        return state;
    }
}
