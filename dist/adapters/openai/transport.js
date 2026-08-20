export class OpenAiApiTransport {
    client;
    model;
    constructor(client, model) {
        this.client = client;
        this.model = model;
    }
    async review(request) {
        return this.client.createResponse({
            model: this.model,
            instructions: request.systemPrompt,
            input: request.handoffMarkdown,
        });
    }
}
