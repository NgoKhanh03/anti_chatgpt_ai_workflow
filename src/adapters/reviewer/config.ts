export type ReviewerTransportType = 'browser' | 'openai';

export interface ReviewerConfig {
  transport: ReviewerTransportType;
  openai?: {
    apiKey?: string;
    model: string;
    baseUrl: string;
  };
}

export function loadReviewerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReviewerConfig {
  const transport = (env.REVIEWER_TRANSPORT ?? 'browser') as ReviewerTransportType;

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
