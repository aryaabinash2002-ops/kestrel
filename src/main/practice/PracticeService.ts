import { EventEmitter } from 'node:events';
import type { PracticeHistoryEntry, PracticeQuestionSet, SessionState } from '@shared/types/ipc';
import type { Settings } from '@shared/types/settings';
import type { SessionDB } from '../db';
import type { AudioManager } from '../audio/AudioManager';
import type { LLMService } from '../llm/LLMService';
import type { SessionManager } from '../session/SessionManager';
import type { TranscriptionService } from '../transcription/TranscriptionService';

export interface PracticeDeps {
  llm: LLMService;
  db: SessionDB;
  sessions: SessionManager;
  audio: AudioManager;
  transcription: TranscriptionService;
  getSettings: () => Settings;
}

/**
 * Practice mode (M11): AI interviewer asks questions (text + TTS in the renderer), listens to
 * the spoken answer on the ME channel, scores it, keeps history per profile.
 * (Implementation filled in by Milestone 11.)
 */
export class PracticeService extends EventEmitter {
  constructor(private deps: PracticeDeps) {
    super();
  }

  async sets(_profileId: string | null): Promise<PracticeQuestionSet[]> {
    void this.deps;
    return [];
  }

  async start(_opts: { profileId: string | null; setId: string; count: number; useTts: boolean }): Promise<SessionState> {
    throw new Error('Practice mode is not implemented yet');
  }

  async submit(_answerText: string): Promise<void> {}
  async skip(): Promise<void> {}
  async stop(): Promise<void> {}
  history(_profileId: string | null): PracticeHistoryEntry[] {
    return [];
  }
}
