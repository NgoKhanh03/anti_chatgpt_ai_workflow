import { withRetry } from './retry.js';
export class HardenedReviewerTransport {
    inner;
    logger;
    metrics;
    retryOptions;
    constructor(inner, logger, metrics, retryOptions = {}) {
        this.inner = inner;
        this.logger = logger;
        this.metrics = metrics;
        this.retryOptions = retryOptions;
    }
    async review(request) {
        this.metrics.incrementReviewerCalls();
        this.logger.info('reviewer.request', {
            prNumber: request.handoff.pullRequest.number,
            repository: `${request.handoff.repository.owner}/${request.handoff.repository.name}`,
        });
        try {
            const response = await withRetry(() => this.inner.review(request), {
                ...this.retryOptions,
                onRetry: (error, nextAttempt, delayMs) => {
                    this.metrics.incrementRetries();
                    this.logger.warn('reviewer.retry', {
                        nextAttempt,
                        delayMs,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this.retryOptions.onRetry?.(error, nextAttempt, delayMs);
                },
            });
            this.logger.info('reviewer.response', { bytes: Buffer.byteLength(response, 'utf8') });
            return response;
        }
        catch (error) {
            this.logger.error('reviewer.failure', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
