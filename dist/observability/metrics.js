export class RunMetrics {
    startedMs = Date.now();
    snapshotValue;
    constructor(runId, taskId, prNumber) {
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
    incrementIteration() { this.snapshotValue.iterations += 1; }
    incrementReviewerCalls() { this.snapshotValue.reviewerCalls += 1; }
    incrementAntigravityCalls() { this.snapshotValue.antigravityCalls += 1; }
    incrementRetries() { this.snapshotValue.retries += 1; }
    finish(outcome, endedMs = Date.now()) {
        this.snapshotValue.outcome = outcome;
        this.snapshotValue.endedAt = new Date(endedMs).toISOString();
        this.snapshotValue.durationMs = Math.max(0, endedMs - this.startedMs);
        return this.snapshot();
    }
    snapshot() {
        return { ...this.snapshotValue };
    }
}
