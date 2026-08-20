export interface ReviewMetrics {
  passed: number;
  total: number;
}

export function calculateReviewPassRate(metrics: ReviewMetrics): number {
  return Math.round((metrics.passed / metrics.total) * 100);
}
