import type { ReviewerTransport } from '../adapters/reviewer/transport.js';
import type { ChatGptReviewRequest } from '../adapters/chatgpt/types.js';
import { StructuredLogger } from './logger.js';
import { RunMetrics } from './metrics.js';
import { withRetry, type RetryOptions } from './retry.js';

export class HardenedReviewerTransport implements ReviewerTransport {
  constructor(
    private readonly inner: ReviewerTransport,
    private readonly logger: StructuredLogger,
    private readonly metrics: RunMetrics,
    private readonly retryOptions: RetryOptions = {},
  ) {}

  async review(request: ChatGptReviewRequest): Promise<string> {
    this.metrics.incrementReviewerCalls();
    this.logger.info('reviewer.request', {
      prNumber: request.handoff.pullRequest.number,
      repository: `${request.handoff.repository.owner}/${request.handoff.repository.name}`,
    });

    try {
      const response = await withRetry(
        () => this.inner.review(request),
        {
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
        },
      );
      this.logger.info('reviewer.response', { bytes: Buffer.byteLength(response, 'utf8') });
      return response;
    } catch (error) {
      this.logger.error('reviewer.failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
