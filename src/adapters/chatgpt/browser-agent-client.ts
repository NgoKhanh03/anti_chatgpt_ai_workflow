import type { ReviewerTransport } from '../reviewer/transport.js';
import type { ChatGptReviewRequest } from './types.js';

export interface BrowserAgentClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class BrowserAgentClientTransport implements ReviewerTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: BrowserAgentClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async review(request: ChatGptReviewRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null) as { response?: string; error?: string } | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error ?? `Browser agent returned HTTP ${response.status}`);
      }
      if (typeof payload?.response !== 'string') {
        throw new Error('Browser agent returned an invalid response payload.');
      }
      return payload.response;
    } finally {
      clearTimeout(timer);
    }
  }
}
