function positiveInteger(value, fallback) {
    if (!value)
        return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Expected positive integer, got: ${value}`);
    }
    return parsed;
}
function booleanValue(value, fallback) {
    if (value === undefined)
        return fallback;
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    throw new Error(`Expected boolean true/false, got: ${value}`);
}
export function loadReviewerConfig(env = process.env) {
    const transport = (env.REVIEWER_TRANSPORT ?? 'browser');
    if (transport !== 'browser' && transport !== 'openai') {
        throw new Error(`Unsupported REVIEWER_TRANSPORT: ${transport}`);
    }
    const browserTimeoutMs = positiveInteger(env.CHATGPT_TIMEOUT_MS, 300_000);
    return {
        transport,
        browser: {
            cdpUrl: env.CHATGPT_CDP_URL,
            agentUrl: env.CHATGPT_AGENT_URL ?? 'http://127.0.0.1:4317',
            chatUrl: env.CHATGPT_URL ?? 'https://chatgpt.com/',
            timeoutMs: browserTimeoutMs,
            agentRequestTimeoutMs: positiveInteger(env.CHATGPT_AGENT_REQUEST_TIMEOUT_MS, browserTimeoutMs + 15_000),
            settleMs: positiveInteger(env.CHATGPT_SETTLE_MS, 2_500),
            newChatPerReview: booleanValue(env.CHATGPT_NEW_CHAT_PER_REVIEW, true),
        },
        openai: {
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_REVIEW_MODEL ?? 'gpt-5',
            baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        },
    };
}
