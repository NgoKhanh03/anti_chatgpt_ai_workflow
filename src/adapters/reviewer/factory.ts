import {
  ChatGptReviewerAdapter,
  UnconfiguredBrowserTransport,
} from '../chatgpt/index.js';
import {
  FetchOpenAiReviewClient,
  OpenAiApiTransport,
} from '../openai/index.js';
import type { ReviewerConfig } from './config.js';
import type { ReviewerTransport } from './transport.js';

export interface ReviewerFactoryOverrides {
  browserTransport?: ReviewerTransport;
  openaiTransport?: ReviewerTransport;
}

export function createReviewer(
  config: ReviewerConfig,
  overrides: ReviewerFactoryOverrides = {},
): ChatGptReviewerAdapter {
  if (config.transport === 'browser') {
    return new ChatGptReviewerAdapter(
      overrides.browserTransport ?? new UnconfiguredBrowserTransport(),
    );
  }

  if (overrides.openaiTransport) {
    return new ChatGptReviewerAdapter(overrides.openaiTransport);
  }

  const openai = config.openai;
  if (!openai?.apiKey) {
    throw new Error('OPENAI_API_KEY is required when REVIEWER_TRANSPORT=openai.');
  }

  const client = new FetchOpenAiReviewClient(openai.apiKey, openai.baseUrl);
  return new ChatGptReviewerAdapter(
    new OpenAiApiTransport(client, openai.model),
  );
}
