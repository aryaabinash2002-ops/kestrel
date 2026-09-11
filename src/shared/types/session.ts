import type { AnswerLength, InterviewType, Tone } from './settings';

export type Speaker = 'ME' | 'THEM' | 'AI';
export type Channel = 'ME' | 'THEM';
export type SessionMode = 'live' | 'practice';

export interface Story {
  id: string;
  title: string;
  text: string;
}

export interface Profile {
  id: string;
  name: string;
  role: string;
  company: string;
  type: InterviewType;
  language: string;
  length: AnswerLength;
  tone: Tone;
  resumeText: string;
  jdText: string;
  stories: Story[];
  notes: string;
  userName: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  profileId: string | null;
  mode: SessionMode;
  startedAt: number;
  endedAt: number | null;
  summary: SessionSummary | null;
}

export interface SessionSummary {
  summary: string;
  questions: string[];
  weakSpots: string[];
  followUpEmail: string;
  actionItems: string[];
  generatedAt: number;
}

export interface Utterance {
  id: string;
  sessionId: string;
  speaker: Speaker;
  text: string;
  /** ms since session start */
  startMs: number;
  endMs: number;
  isFinal: boolean;
  /** Source of this utterance ('stt' = transcription provider, 'captions' = Meet captions). */
  source: 'stt' | 'captions' | 'chat';
  /** Speaker display name when known (from captions). */
  speakerName?: string;
}

export type QuestionType =
  | 'behavioral'
  | 'technical'
  | 'system_design'
  | 'coding'
  | 'situational'
  | 'smalltalk'
  | 'factual'
  | 'sales'
  | 'other';

export interface AnswerLatency {
  questionEndTs: number | null;
  requestStartTs: number;
  firstTokenTs: number | null;
  headlineDoneTs: number | null;
  doneTs: number | null;
  speculative: boolean;
  restarted: boolean;
}

export interface AnswerCard {
  id: string;
  sessionId: string;
  question: string;
  type: QuestionType | null;
  headline: string;
  points: string[];
  /** Raw streamed content (whole model output). */
  content: string;
  model: string;
  status: 'streaming' | 'done' | 'cancelled' | 'error' | 'dismissed';
  error?: string;
  latency: AnswerLatency;
  kind: 'auto' | 'manual' | 'chat' | 'smalltalk';
  /** Headline/points carried over from a cancelled speculative answer while the restart streams. */
  stale?: boolean;
  createdAt: number;
}

export interface ScreenshotResult {
  id: string;
  sessionId: string | null;
  path: string;
  result: string;
  status: 'streaming' | 'done' | 'error';
  createdAt: number;
}

export interface PracticeScore {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  score: {
    score: number;
    relevance: number;
    structure: number;
    specificity: number;
    conciseness: number;
    strengths: string[];
    improve_one_thing: string;
    model_answer: string;
  };
  createdAt: number;
}

export interface LatencySample {
  answerId: string;
  questionEndTs: number | null;
  requestStartTs: number;
  firstTokenTs: number | null;
  headlineDoneTs: number | null;
  speculative: boolean;
  restarted: boolean;
  createdAt: number;
}
