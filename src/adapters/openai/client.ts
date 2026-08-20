export interface OpenAiResponseRequest {
  model: string;
  instructions: string;
  input: string;
}

export interface OpenAiReviewClient {
  createResponse(request: OpenAiResponseRequest): Promise<string>;
}

interface ResponsesApiPayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

export class FetchOpenAiReviewClient implements OpenAiReviewClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async createResponse(request: OpenAiResponseRequest): Promise<string> {
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

    const data = (await response.json()) as ResponsesApiPayload;
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
