import {
  deterministicChecksPassed,
  hasCommit,
  type AntigravityAdapter,
  type TaskContract,
} from '../adapters/antigravity/index.js';
import type { ChatGptReviewerAdapter, ReviewIssue, ReviewResult } from '../adapters/chatgpt/index.js';
import type { CiState, GitHubClient } from '../github/index.js';
import type { StateStore, WorkflowPersistedState } from '../state/index.js';
import { assertApprovalCurrent, createApprovalEvidence } from '../review/index.js';
import { transition, type WorkflowState } from './workflow-state.js';

export interface ReviewLoopPolicy {
  maxIterations: number;
}

export interface ReviewLoopResult {
  state: WorkflowState;
  iteration: number;
  review?: ReviewResult;
}

function isBlocking(issue: ReviewIssue): boolean {
  return issue.severity === 'P0' || issue.severity === 'P1';
}

export class ReviewLoopCoordinator {
  constructor(
    private readonly github: GitHubClient,
    private readonly reviewer: ChatGptReviewerAdapter,
    private readonly cleanRoomReviewer: ChatGptReviewerAdapter,
    private readonly antigravity: AntigravityAdapter,
    private readonly stateStore: StateStore,
    private readonly policy: ReviewLoopPolicy,
  ) {
    if (!Number.isInteger(policy.maxIterations) || policy.maxIterations <= 0) {
      throw new Error('Review loop maxIterations must be a positive integer.');
    }
  }

  private async persist(state: WorkflowPersistedState): Promise<void> {
    await this.stateStore.save(state);
  }

  private syncIssues(state: WorkflowPersistedState, review: ReviewResult): void {
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

  private markBlockingIssuesFixed(state: WorkflowPersistedState, review: ReviewResult): void {
    for (const issue of review.issues.filter(isBlocking)) {
      const tracked = state.issues[issue.id];
      if (tracked) tracked.status = 'FIXED';
    }
  }

  private async handleCiState(
    state: WorkflowPersistedState,
    ciState: CiState,
  ): Promise<ReviewLoopResult | undefined> {
    if (ciState === 'SUCCESS') return undefined;

    if (ciState === 'FAILURE') {
      state.state = transition(state.state, 'FIXING');
    } else if (ciState === 'UNKNOWN') {
      state.state = transition(state.state, 'NEEDS_HUMAN');
    }

    await this.persist(state);
    return { state: state.state, iteration: state.iteration };
  }

  private async fixBlockingIssues(
    state: WorkflowPersistedState,
    task: TaskContract,
    review: ReviewResult,
  ): Promise<boolean> {
    const blocking = review.issues.filter(isBlocking);
    state.state = transition(state.state, 'FIXING');
    await this.persist(state);

    const execution = await this.antigravity.fix(
      task,
      blocking.map((issue) => ({
        id: issue.id,
        severity: issue.severity,
        problem: issue.problem,
        recommendedFix: issue.recommendedFix,
      })),
    );

    const readyForReview = deterministicChecksPassed(execution) && hasCommit(execution);
    if (readyForReview) {
      this.markBlockingIssuesFixed(state, review);
    }

    state.state = transition(state.state, 'TESTING');
    if (!readyForReview) {
      state.state = transition(state.state, 'FIXING');
    }
    await this.persist(state);

    return readyForReview;
  }

  private async runCleanRoomReview(
    state: WorkflowPersistedState,
    task: TaskContract,
    prNumber: number,
  ): Promise<ReviewLoopResult | undefined> {
    const cleanHandoff = await this.github.createHandoffPacket(prNumber);
    const ciResult = await this.handleCiState(state, cleanHandoff.pullRequest.ciState);
    if (ciResult) return ciResult;

    const finalReview = await this.cleanRoomReviewer.review(cleanHandoff);
    this.syncIssues(state, finalReview);

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

  async run(task: TaskContract, prNumber: number): Promise<ReviewLoopResult> {
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
      const resumedFinalReview = await this.runCleanRoomReview(state, task, prNumber);
      if (resumedFinalReview) return resumedFinalReview;
    }

    while (state.iteration < this.policy.maxIterations) {
      if (state.state === 'PR_CREATED') {
        state.state = transition(state.state, 'AI_REVIEWING');
      } else if (state.state === 'TESTING') {
        state.state = transition(state.state, 'PR_CREATED');
        state.state = transition(state.state, 'AI_REVIEWING');
      }

      await this.persist(state);

      const handoff = await this.github.createHandoffPacket(prNumber);
      const ciResult = await this.handleCiState(state, handoff.pullRequest.ciState);
      if (ciResult) return ciResult;

      const review = await this.reviewer.review(handoff);
      state.approval = undefined;
      state.iteration += 1;
      this.syncIssues(state, review);
      await this.persist(state);

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

      const finalResult = await this.runCleanRoomReview(state, task, prNumber);
      if (finalResult) return finalResult;
    }

    state.state = transition(state.state, 'NEEDS_HUMAN');
    await this.persist(state);
    return { state: state.state, iteration: state.iteration };
  }

  async approveMerge(): Promise<WorkflowPersistedState> {
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
