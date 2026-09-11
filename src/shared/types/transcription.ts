import type { Channel } from './session';

export type TranscriberStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface TranscriptionState {
  channel: Channel;
  status: TranscriberStatus;
  provider: string;
  message?: string;
  reconnectAttempt?: number;
}

export interface TranscriptWord {
  word: string;
  startWallMs: number;
  endWallMs: number;
}

/** One transcription result (interim or final) with provider audio time mapped to wall-clock ms. */
export interface TranscriptResult {
  channel: Channel;
  text: string;
  isFinal: boolean;
  /** Provider signalled end of utterance (endpointing). */
  speechFinal: boolean;
  startWallMs: number;
  endWallMs: number;
  /** Wall-clock ms when this result was received. */
  receivedAt: number;
  words?: TranscriptWord[];
}

export interface TranscriberStats {
  channel: Channel;
  interimCount: number;
  finalCount: number;
  avgInterimGapMs: number;
  reconnects: number;
}
