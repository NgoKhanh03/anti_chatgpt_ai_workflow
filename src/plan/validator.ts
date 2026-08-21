import { topologicalSort } from './dependency-graph.js';
import type { FeaturePlan, PhasePlan, WorkflowPlan } from './types.js';

export class PlanValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Workflow plan is invalid:\n- ${issues.join('\n- ')}`);
    this.name = 'PlanValidationError';
  }
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function validateFeature(feature: FeaturePlan, issues: string[]): void {
  const criterionIds = feature.acceptanceCriteria.map((criterion) => criterion.id);
  for (const duplicate of duplicates(criterionIds)) issues.push(`Feature ${feature.id} has duplicate criterion ${duplicate}`);
  for (const duplicate of duplicates(feature.units.map((unit) => unit.id))) {
    issues.push(`Feature ${feature.id} has duplicate unit ${duplicate}`);
  }

  const covered = new Set<string>();
  for (const unit of feature.units) {
    if (unit.acceptanceCriteriaIds.length === 0) {
      issues.push(`Unit ${unit.id} does not cover any acceptance criterion`);
    }
    for (const criterionId of unit.acceptanceCriteriaIds) {
      if (!criterionIds.includes(criterionId)) {
        issues.push(`Unit ${unit.id} references unknown criterion ${criterionId}`);
      } else {
        covered.add(criterionId);
      }
    }
  }
  for (const criterionId of criterionIds) {
    if (!covered.has(criterionId)) issues.push(`Feature ${feature.id} criterion ${criterionId} is not covered by any unit`);
  }

  try {
    topologicalSort(feature.units);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
}

function validatePhase(phase: PhasePlan, issues: string[]): void {
  const phaseCriterionIds = phase.acceptanceCriteria.map((criterion) => criterion.id);
  const covered = new Set(phase.features.flatMap((feature) => feature.coversPhaseCriteria));
  for (const feature of phase.features) {
    for (const criterionId of feature.coversPhaseCriteria) {
      if (!phaseCriterionIds.includes(criterionId)) {
        issues.push(`Feature ${feature.id} references unknown phase criterion ${criterionId}`);
      }
    }
    validateFeature(feature, issues);
  }
  for (const criterionId of phaseCriterionIds) {
    if (!covered.has(criterionId)) issues.push(`Phase ${phase.id} criterion ${criterionId} is not covered by any feature`);
  }

}

export function validatePlan(plan: WorkflowPlan): WorkflowPlan {
  const issues: string[] = [];
  if (!plan.id.trim()) issues.push('Plan id is required');
  if (!Number.isInteger(plan.revision) || plan.revision <= 0) issues.push('Plan revision must be a positive integer');
  if (plan.phases.length === 0) issues.push('Plan requires at least one phase');

  for (const duplicate of duplicates(plan.phases.map((phase) => phase.id))) {
    issues.push(`Duplicate phase id ${duplicate}`);
  }
  const allFeatureIds = plan.phases.flatMap((phase) => phase.features.map((feature) => feature.id));
  for (const duplicate of duplicates(allFeatureIds)) issues.push(`Duplicate feature id ${duplicate}`);
  const allUnitIds = plan.phases.flatMap((phase) => phase.features.flatMap((feature) => feature.units.map((unit) => unit.id)));
  for (const duplicate of duplicates(allUnitIds)) issues.push(`Duplicate unit id ${duplicate}`);

  for (const phase of plan.phases) validatePhase(phase, issues);

  const allFeatures = plan.phases.flatMap((phase) => phase.features);
  try {
    topologicalSort(allFeatures);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  const featurePhase = new Map<string, number>();
  plan.phases.forEach((phase, phaseIndex) => {
    phase.features.forEach((feature) => featurePhase.set(feature.id, phaseIndex));
  });
  plan.phases.forEach((phase, phaseIndex) => {
    for (const feature of phase.features) {
      for (const dependency of feature.dependencies) {
        const dependencyPhase = featurePhase.get(dependency);
        if (dependencyPhase !== undefined && dependencyPhase > phaseIndex) {
          issues.push(`Feature ${feature.id} depends on future-phase feature ${dependency}`);
        }
      }
    }
  });
  if (issues.length > 0) throw new PlanValidationError(issues);
  return plan;
}
