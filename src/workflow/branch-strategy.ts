export type HumanGateMode = 'phase' | 'final' | 'custom';

export interface HumanGateConfig {
  mode: HumanGateMode;
  afterPhases?: string[];
  final?: boolean;
}

export interface PhaseBranchPlan {
  phaseId: string;
  baseBranch: string;
  workBranch: string;
  mergeTarget: string;
  requiresHumanGate: boolean;
}

export interface RunBranchStrategy {
  mode: HumanGateMode;
  integrationBranch?: string;
  finalMergeTarget: string;
  requiresFinalApproval: boolean;
  phases: PhaseBranchPlan[];
}

function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!result) throw new Error(`Cannot derive branch slug from ${value}`);
  return result;
}

export function resolveBranchStrategy(
  runId: string,
  phaseIds: string[],
  config: HumanGateConfig,
  mainBranch = 'main',
): RunBranchStrategy {
  if (phaseIds.length === 0) throw new Error('Branch strategy requires at least one phase.');
  if (new Set(phaseIds).size !== phaseIds.length) throw new Error('Phase ids must be unique.');
  if (config.mode === 'custom' && config.final !== true) {
    throw new Error('Custom human gates require final approval before merging to main.');
  }

  const integrationBranch = config.mode === 'phase' ? undefined : `run/${slug(runId)}`;
  const customGates = new Set(config.afterPhases ?? []);
  if (config.mode === 'custom') {
    for (const phaseId of customGates) {
      if (!phaseIds.includes(phaseId)) throw new Error(`Unknown custom gate phase ${phaseId}`);
    }
  }

  const phases = phaseIds.map((phaseId) => ({
    phaseId,
    baseBranch: config.mode === 'phase' ? mainBranch : integrationBranch!,
    workBranch: `phase/${slug(phaseId)}`,
    mergeTarget: config.mode === 'phase' ? mainBranch : integrationBranch!,
    requiresHumanGate: config.mode === 'phase' || (config.mode === 'custom' && customGates.has(phaseId)),
  }));

  return {
    mode: config.mode,
    integrationBranch,
    finalMergeTarget: mainBranch,
    requiresFinalApproval: config.mode !== 'phase' || config.final === true,
    phases,
  };
}

export function assertMergeAllowed(
  strategy: RunBranchStrategy,
  targetBranch: string,
  approvals: { phaseApproved?: boolean; finalApproved?: boolean },
): void {
  if (targetBranch === strategy.finalMergeTarget) {
    if (strategy.mode === 'phase') {
      if (!approvals.phaseApproved) throw new Error('Phase approval is required before merging to main.');
    } else if (!approvals.finalApproved) {
      throw new Error('Final approval is required before merging the integration branch to main.');
    }
    return;
  }

  if (targetBranch === strategy.integrationBranch) {
    if (strategy.mode === 'phase') throw new Error('Phase mode does not use an integration branch.');
    return;
  }
  throw new Error(`Merge target is outside the configured branch strategy: ${targetBranch}`);
}
