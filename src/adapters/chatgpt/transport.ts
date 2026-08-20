import type { ReviewerTransport } from '../reviewer/transport.js';

export interface ChatGptBrowserTransport extends ReviewerTransport {}

export class UnconfiguredBrowserTransport implements ChatGptBrowserTransport {
  async review(): Promise<string> {
    throw new Error(
      'ChatGPT browser transport is not configured. Provide a browser automation implementation.',
    );
  }
}
