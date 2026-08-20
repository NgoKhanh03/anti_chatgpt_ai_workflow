import type { UnitScopePolicy } from '../policy/index.js';

export interface AcceptanceCriterion {
  id: string;
  text: string;
}

export interface ReviewBudget {
  maxFiles: number;
  maxDiffLines: number;
}

export interface ReviewUnitPlan {
  id: string;
  goal: string;
  acceptanceCriteriaIds: string[];
  dependencies: string[];
  scope: UnitScopePolicy;
  reviewBudget: ReviewBudget;
}

export interface FeaturePlan {
  id: string;
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  coversPhaseCriteria: string[];
  dependencies: string[];
  units: ReviewUnitPlan[];
}

export interface PhasePlan {
  id: string;
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  features: FeaturePlan[];
}

export interface WorkflowPlan {
  id: string;
  revision: number;
  globalConstraints: string[];
  phases: PhasePlan[];
}

export type FeatureStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'NEEDS_HUMAN';
