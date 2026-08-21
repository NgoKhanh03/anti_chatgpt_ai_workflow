import { createHash } from 'node:crypto';
import type { PrHandoffPacket } from '../github/index.js';

export interface ApprovalEvidence {
  baseSha: string;
  headSha: string;
  diffHash: string;
  ciState: 'SUCCESS';
  approvedAt: string;
  reviewerArtifactId?: string;
}

function hashDiff(handoff: PrHandoffPacket): string {
  return createHash('sha256')
    .update(handoff.diff.patch)
    .update('\0')
    .update(JSON.stringify(handoff.diff.files))
    .digest('hex');
}

function requireSha(value: string, field: string): string {
  if (!/^[0-9a-f]{7,64}$/i.test(value)) {
    throw new Error(`${field} must be a Git commit SHA.`);
  }
  return value;
}

export function createApprovalEvidence(
  handoff: PrHandoffPacket,
  reviewerArtifactId?: string,
): ApprovalEvidence {
  if (handoff.pullRequest.ciState !== 'SUCCESS') {
    throw new Error('Approval evidence requires successful CI.');
  }

  return {
    baseSha: requireSha(handoff.pullRequest.baseSha, 'baseSha'),
    headSha: requireSha(handoff.pullRequest.headSha, 'headSha'),
    diffHash: hashDiff(handoff),
    ciState: 'SUCCESS',
    approvedAt: new Date().toISOString(),
    reviewerArtifactId,
  };
}

export function assertApprovalCurrent(
  evidence: ApprovalEvidence,
  currentHandoff: PrHandoffPacket,
): void {
  if (currentHandoff.pullRequest.ciState !== 'SUCCESS') {
    throw new Error('Approval is stale because CI is no longer successful.');
  }
  if (
    evidence.baseSha !== currentHandoff.pullRequest.baseSha ||
    evidence.headSha !== currentHandoff.pullRequest.headSha ||
    evidence.diffHash !== hashDiff(currentHandoff)
  ) {
    throw new Error('Approval is stale because the reviewed Git state has changed.');
  }
}
