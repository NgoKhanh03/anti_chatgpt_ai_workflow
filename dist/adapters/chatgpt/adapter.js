import { renderHandoffMarkdown } from '../../github/handoff.js';
import { parseReviewResponse } from './parser.js';
import { DEFAULT_REVIEWER_PROMPT } from './prompt.js';
export class ChatGptReviewerAdapter {
    transport;
    systemPrompt;
    constructor(transport, systemPrompt = DEFAULT_REVIEWER_PROMPT) {
        this.transport = transport;
        this.systemPrompt = systemPrompt;
    }
    async review(handoff, scopedContextMarkdown) {
        const response = await this.transport.review({
            systemPrompt: this.systemPrompt,
            handoff,
            handoffMarkdown: scopedContextMarkdown ?? renderHandoffMarkdown(handoff),
        });
        return parseReviewResponse(response);
    }
}
