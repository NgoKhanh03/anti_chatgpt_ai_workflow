import { renderHandoffMarkdown } from '../../github/handoff.js';
import type { PrHandoffPacket } from '../../github/types.js';
import type { ReviewerTransport } from '../reviewer/transport.js';
import { parseReviewResponse } from './parser.js';
import { DEFAULT_REVIEWER_PROMPT } from './prompt.js';
import type { ProjectReviewContext, ReviewResult } from './types.js';

export class ChatGptReviewerAdapter {
  constructor(
    private readonly transport: ReviewerTransport,
    private readonly systemPrompt = DEFAULT_REVIEWER_PROMPT,
  ) {}

  async review(
    handoff: PrHandoffPacket,
    scopedContextMarkdown?: string,
    projectContext?: ProjectReviewContext,
  ): Promise<ReviewResult> {
    const response = await this.transport.review({
      systemPrompt: this.systemPrompt,
      handoff,
      handoffMarkdown: scopedContextMarkdown ?? renderHandoffMarkdown(handoff),
      projectContext,
    });

    return parseReviewResponse(response);
  }
}
