import type { SessionSummary } from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import type { SessionDB } from '../db';
import type { LLMService } from '../llm/LLMService';
import type { Paths } from '../paths';
import type { WindowManager } from '../windows';

export interface ReviewDeps {
  llm: LLMService;
  db: SessionDB;
  paths: Paths;
  windows: WindowManager;
  getSettings: () => Settings;
}

/**
 * Post-session review (M10): generates the summary/questions/weak spots/follow-up email/
 * action items with the strong model and exports sessions to Markdown or PDF.
 * (Implementation filled in by Milestone 10.)
 */
export class ReviewService {
  constructor(private deps: ReviewDeps) {}

  async generate(_sessionId: string): Promise<SessionSummary> {
    void this.deps;
    throw new Error('Review generation is not implemented yet');
  }

  async export(_sessionId: string, _format: 'md' | 'pdf'): Promise<{ path: string }> {
    throw new Error('Export is not implemented yet');
  }
}
