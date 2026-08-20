import type { ChatGptReviewRequest } from '../chatgpt/types.js';

export interface ReviewerTransport {
  review(request: ChatGptReviewRequest): Promise<string>;
}
