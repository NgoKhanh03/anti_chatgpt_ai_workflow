import type { PrHandoffPacket } from '../../github/types.js';

export type ReviewVerdict = 'APPROVE' | 'REQUEST_CHANGES';
export type ReviewSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface ReviewIssue {
  id: string;
  severity: ReviewSeverity;
  file?: string;
  line?: number;
  problem: string;
  evidence?: string;
  recommendedFix?: string;
}

export interface ReviewResult {
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
}

export interface ProjectReviewContext {
  projectId: string;
  overview?: string;
  progress?: string;
  conversationId?: string;
  forceNewConversation?: boolean;
}

export interface ChatGptReviewRequest {
  systemPrompt: string;
  handoff: PrHandoffPacket;
  handoffMarkdown: string;
  projectContext?: ProjectReviewContext;
}
