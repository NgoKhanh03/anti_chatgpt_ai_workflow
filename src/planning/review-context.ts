import type { PrHandoffPacket } from '../github/index.js';
import { renderHandoffMarkdown } from '../github/index.js';
import type { AcceptanceCriterion, ReviewUnitPlan } from '../plan/index.js';

export interface UnitReviewContextInput {
  runId: string;
  phase: { id: string; goal: string };
  feature: { id: string; goal: string; acceptanceCriteria: AcceptanceCriterion[] };
  unit: ReviewUnitPlan;
  globalConstraints: string[];
  dependencyEvidence: Array<{ id: string; headSha: string; status: 'APPROVED' }>;
  handoff: PrHandoffPacket;
  maxContextTokens?: number;
}

export interface UnitReviewContext {
  markdown: string;
  estimatedTokens: number;
  changedFiles: number;
  diffLines: number;
  decision: 'READY' | 'SPLIT_REQUIRED';
  reasons: string[];
}

export interface PhaseReviewEvidence {
  phaseId: string;
  goal: string;
  acceptanceSummary: string[];
  artifactPath: string;
  headSha: string;
  changedFiles: string[];
  riskTags: string[];
  estimatedTokens: number;
}

export interface SystemReviewSlice {
  id: string;
  focus: string[];
  evidence: PhaseReviewEvidence[];
  estimatedTokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildUnitReviewContext(input: UnitReviewContextInput): UnitReviewContext {
  const criteria = input.feature.acceptanceCriteria
    .filter((criterion) => input.unit.acceptanceCriteriaIds.includes(criterion.id))
    .map((criterion) => `- ${criterion.id}: ${criterion.text}`)
    .join('\n');
  const dependencies = input.dependencyEvidence
    .map((dependency) => `- ${dependency.id}: ${dependency.status} @ ${dependency.headSha}`)
    .join('\n');
  const constraints = input.globalConstraints.map((constraint) => `- ${constraint}`).join('\n');
  const markdown = [
    '# Review Unit',
    '',
    `Run: ${input.runId}`,
    `Phase: ${input.phase.id} — ${input.phase.goal}`,
    `Feature: ${input.feature.id} — ${input.feature.goal}`,
    `Unit: ${input.unit.id} — ${input.unit.goal}`,
    '',
    '## Acceptance Criteria',
    criteria || '- None',
    '',
    '## Global Constraints',
    constraints || '- None',
    '',
    '## Approved Dependencies',
    dependencies || '- None',
    '',
    renderHandoffMarkdown(input.handoff),
  ].join('\n');

  const changedFiles = input.handoff.diff.files.length;
  const diffLines = input.handoff.diff.patch === '' ? 0 : input.handoff.diff.patch.split('\n').length;
  const tokens = estimateTokens(markdown);
  const reasons: string[] = [];
  if (changedFiles > input.unit.reviewBudget.maxFiles) {
    reasons.push(`Changed files ${changedFiles} exceed budget ${input.unit.reviewBudget.maxFiles}`);
  }
  if (diffLines > input.unit.reviewBudget.maxDiffLines) {
    reasons.push(`Diff lines ${diffLines} exceed budget ${input.unit.reviewBudget.maxDiffLines}`);
  }
  const maxContextTokens = input.maxContextTokens ?? 12_000;
  if (tokens > maxContextTokens) reasons.push(`Estimated tokens ${tokens} exceed budget ${maxContextTokens}`);

  return {
    markdown,
    estimatedTokens: tokens,
    changedFiles,
    diffLines,
    decision: reasons.length > 0 ? 'SPLIT_REQUIRED' : 'READY',
    reasons,
  };
}

export function createSystemReviewSlices(
  evidence: PhaseReviewEvidence[],
  maxEstimatedTokens: number,
): SystemReviewSlice[] {
  if (!Number.isInteger(maxEstimatedTokens) || maxEstimatedTokens <= 0) {
    throw new Error('System review token budget must be a positive integer.');
  }

  const slices: SystemReviewSlice[] = [];
  let current: PhaseReviewEvidence[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    slices.push({
      id: `SYSTEM-SLICE-${String(slices.length + 1).padStart(2, '0')}`,
      focus: [...new Set(current.flatMap((item) => item.riskTags))].sort(),
      evidence: current,
      estimatedTokens: currentTokens,
    });
    current = [];
    currentTokens = 0;
  };

  for (const item of evidence) {
    if (item.estimatedTokens > maxEstimatedTokens) {
      throw new Error(`Phase evidence ${item.phaseId} exceeds the system review budget and must be summarized.`);
    }
    if (currentTokens + item.estimatedTokens > maxEstimatedTokens) flush();
    current.push(item);
    currentTokens += item.estimatedTokens;
  }
  flush();
  return slices;
}
