export type RunOutcome = 'HUMAN_APPROVAL' | 'NEEDS_HUMAN' | 'MERGED' | 'FAILED';

export interface RunMetricsSnapshot {
  runId: string;
  taskId?: string;
  prNumber?: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  outcome?: RunOutcome;
  iterations: number;
  reviewerCalls: number;
  antigravityCalls: number;
  retries: number;
}

export class RunMetrics {
  private readonly startedMs = Date.now();
  private readonly snapshotValue: RunMetricsSnapshot;

  constructor(runId: string, taskId?: string, prNumber?: number) {
    this.snapshotValue = {
      runId,
      taskId,
      prNumber,
      startedAt: new Date(this.startedMs).toISOString(),
      iterations: 0,
      reviewerCalls: 0,
      antigravityCalls: 0,
      retries: 0,
    };
  }

  incrementIteration(): void { this.snapshotValue.iterations += 1; }
  incrementReviewerCalls(): void { this.snapshotValue.reviewerCalls += 1; }
  incrementAntigravityCalls(): void { this.snapshotValue.antigravityCalls += 1; }
  incrementRetries(): void { this.snapshotValue.retries += 1; }

  finish(outcome: RunOutcome, endedMs = Date.now()): RunMetricsSnapshot {
    this.snapshotValue.outcome = outcome;
    this.snapshotValue.endedAt = new Date(endedMs).toISOString();
    this.snapshotValue.durationMs = Math.max(0, endedMs - this.startedMs);
    return this.snapshot();
  }

  snapshot(): RunMetricsSnapshot {
    return { ...this.snapshotValue };
  }
}
