const TRANSIENT_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENETUNREACH',
]);
export function isTransientError(error) {
    if (!error || typeof error !== 'object')
        return false;
    const candidate = error;
    if (candidate.status !== undefined) {
        return candidate.status === 408 ||
            candidate.status === 409 ||
            candidate.status === 425 ||
            candidate.status === 429 ||
            candidate.status >= 500;
    }
    return typeof candidate.code === 'string' && TRANSIENT_CODES.has(candidate.code);
}
export async function withRetry(operation, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 250;
    const maxDelayMs = options.maxDelayMs ?? 4000;
    const shouldRetry = options.shouldRetry ?? isTransientError;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let attempt = 1;
    while (true) {
        try {
            return await operation();
        }
        catch (error) {
            if (attempt >= maxAttempts || !shouldRetry(error))
                throw error;
            const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
            const nextAttempt = attempt + 1;
            options.onRetry?.(error, nextAttempt, delayMs);
            await sleep(delayMs);
            attempt = nextAttempt;
        }
    }
}
