import type { Channel } from './session';

export type TranscriberStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface TranscriptionState {
  channel: Channel;
  status: TranscriberStatus;
  provider: string;
  message?: string;
  reconnectAttempt?: number;
}

export interface TranscriptResult {
  channel: Channel;
  text: string;
  isFinal: boolean;
  /** Provider-side audio time (seconds) of the first word. */
  start: number;
  /** Provider-side audio time (seconds) of the last word end. */
  end: number;
  /** Wall-clock ts (ms) when this result was received. */
  receivedAt: number;
  /** True when the provider signalled end of utterance (endpointing). */
  speechFinal: boolean;
  words?: { word: string; start: number; end: number }[];
}
