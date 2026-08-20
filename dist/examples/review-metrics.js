export function calculateReviewPassRate(metrics) {
    return Math.round((metrics.passed / metrics.total) * 100);
}
