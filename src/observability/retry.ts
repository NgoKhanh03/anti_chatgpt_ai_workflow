export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void;
  sleep?: (delayMs: number) => Promise<void>;
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: number; code?: string };
  if (candidate.status !== undefined) {
    return candidate.status === 408 ||
      candidate.status === 409 ||
      candidate.status === 425 ||
      candidate.status === 429 ||
      candidate.status >= 500;
  }
  return typeof candidate.code === 'string' && TRANSIENT_CODES.has(candidate.code);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const shouldRetry = options.shouldRetry ?? isTransientError;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const nextAttempt = attempt + 1;
      options.onRetry?.(error, nextAttempt, delayMs);
      await sleep(delayMs);
      attempt = nextAttempt;
    }
  }
}
