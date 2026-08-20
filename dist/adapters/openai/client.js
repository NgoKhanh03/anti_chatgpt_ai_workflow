export class FetchOpenAiReviewClient {
    apiKey;
    baseUrl;
    constructor(apiKey, baseUrl = 'https://api.openai.com/v1') {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }
    async createResponse(request) {
        const response = await fetch(`${this.baseUrl}/responses`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: request.model,
                instructions: request.instructions,
                input: request.input,
            }),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`OpenAI Responses API failed (${response.status}): ${body}`);
        }
        const data = (await response.json());
        if (typeof data.output_text === 'string' && data.output_text.length > 0) {
            return data.output_text;
        }
        const text = data.output
            ?.flatMap((item) => item.content ?? [])
            .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
            .map((item) => item.text)
            .join('\n');
        if (!text) {
            throw new Error('OpenAI response did not contain output text.');
        }
        return text;
    }
}
