import { ChatGptReviewerAdapter, BrowserAgentClientTransport, } from '../chatgpt/index.js';
import { FetchOpenAiReviewClient, OpenAiApiTransport, } from '../openai/index.js';
export function createReviewer(config, overrides = {}) {
    if (config.transport === 'browser') {
        const browser = config.browser;
        return new ChatGptReviewerAdapter(overrides.browserTransport ?? new BrowserAgentClientTransport({
            baseUrl: browser?.agentUrl,
            timeoutMs: browser?.agentRequestTimeoutMs,
        }));
    }
    if (overrides.openaiTransport) {
        return new ChatGptReviewerAdapter(overrides.openaiTransport);
    }
    const openai = config.openai;
    if (!openai?.apiKey) {
        throw new Error('OPENAI_API_KEY is required when REVIEWER_TRANSPORT=openai.');
    }
    const client = new FetchOpenAiReviewClient(openai.apiKey, openai.baseUrl);
    return new ChatGptReviewerAdapter(new OpenAiApiTransport(client, openai.model));
}
