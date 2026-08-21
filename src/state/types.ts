import type { WorkflowState } from '../orchestrator/workflow-state.js';
import type { ApprovalEvidence } from '../review/index.js';

export type ReviewIssueStatus = 'OPEN' | 'FIXED' | 'VERIFIED';

export interface ReviewIssueState {
  id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  status: ReviewIssueStatus;
  problem?: string;
  recommendedFix?: string;
}

export interface WorkflowPersistedState {
  state: WorkflowState;
  iteration: number;
  taskId?: string;
  prNumber?: number;
  issues: Record<string, ReviewIssueState>;
  approval?: ApprovalEvidence;
  updatedAt: string;
}

export function createInitialState(): WorkflowPersistedState {
  return {
    state: 'NEW',
    iteration: 0,
    issues: {},
    updatedAt: new Date().toISOString(),
  };
}
