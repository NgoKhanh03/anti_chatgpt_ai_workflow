import type { ReviewerTransport } from '../reviewer/transport.js';
import type { ChatGptReviewRequest } from '../chatgpt/types.js';
import type { OpenAiReviewClient } from './client.js';

export class OpenAiApiTransport implements ReviewerTransport {
  constructor(
    private readonly client: OpenAiReviewClient,
    private readonly model: string,
  ) {}

  async review(request: ChatGptReviewRequest): Promise<string> {
    return this.client.createResponse({
      model: this.model,
      instructions: request.systemPrompt,
      input: request.handoffMarkdown,
    });
  }
}
