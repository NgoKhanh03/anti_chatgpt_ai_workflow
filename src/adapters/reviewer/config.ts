export type ReviewerTransportType = 'browser' | 'openai';

export interface ReviewerConfig {
  transport: ReviewerTransportType;
  browser?: {
    cdpUrl?: string;
    agentUrl: string;
    chatUrl: string;
    timeoutMs: number;
    settleMs: number;
    newChatPerReview: boolean;
  };
  openai?: {
    apiKey?: string;
    model: string;
    baseUrl: string;
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got: ${value}`);
  }
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected boolean true/false, got: ${value}`);
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
    browser: {
      cdpUrl: env.CHATGPT_CDP_URL,
      agentUrl: env.CHATGPT_AGENT_URL ?? 'http://127.0.0.1:4317',
      chatUrl: env.CHATGPT_URL ?? 'https://chatgpt.com/',
      timeoutMs: positiveInteger(env.CHATGPT_TIMEOUT_MS, 180_000),
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
