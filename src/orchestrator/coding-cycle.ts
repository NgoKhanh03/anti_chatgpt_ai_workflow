import type {
  AntigravityAdapter,
  AntigravityExecutionResult,
  TaskContract,
} from '../adapters/antigravity/index.js';
import { deterministicChecksPassed } from '../adapters/antigravity/index.js';
import { transition, type WorkflowState } from './workflow-state.js';

export interface CodingCycleResult {
  state: WorkflowState;
  execution: AntigravityExecutionResult;
}

export class CodingCycleCoordinator {
  constructor(private readonly antigravity: AntigravityAdapter) {}

  async implement(task: TaskContract): Promise<CodingCycleResult> {
    let state: WorkflowState = 'NEW';
    state = transition(state, 'CODING');

    const execution = await this.antigravity.implement(task);
    state = transition(state, 'TESTING');

    if (!deterministicChecksPassed(execution)) {
      state = transition(state, 'FIXING');
    }

    return { state, execution };
  }

  async fix(
    task: TaskContract,
    issues: Array<{
      id: string;
      severity: 'P0' | 'P1' | 'P2' | 'P3';
      problem: string;
      recommendedFix?: string;
    }>,
  ): Promise<CodingCycleResult> {
    let state: WorkflowState = 'FIXING';
    const execution = await this.antigravity.fix(task, issues);
    state = transition(state, 'TESTING');

    if (!deterministicChecksPassed(execution)) {
      state = transition(state, 'FIXING');
    }

    return { state, execution };
  }
}
