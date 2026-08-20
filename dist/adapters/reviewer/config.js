export function loadReviewerConfig(env = process.env) {
    const transport = (env.REVIEWER_TRANSPORT ?? 'browser');
    if (transport !== 'browser' && transport !== 'openai') {
        throw new Error(`Unsupported REVIEWER_TRANSPORT: ${transport}`);
    }
    return {
        transport,
        openai: {
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_REVIEW_MODEL ?? 'gpt-5',
            baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        },
    };
}
