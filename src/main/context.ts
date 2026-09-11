import type { SessionDB } from './db';
import type { HotkeyManager } from './hotkeys';
import type { Paths } from './paths';
import type { SecretStore } from './secrets';
import type { SettingsStore } from './settings';
import type { WindowManager } from './windows';
import type { SessionManager } from './session/SessionManager';
import type { AudioManager } from './audio/AudioManager';
import type { TranscriptionService } from './transcription/TranscriptionService';
import type { ExtensionBridge } from './extension/ExtensionBridge';
import type { LLMService } from './llm/LLMService';
import type { AnswerEngine } from './llm/AnswerEngine';
import type { AutoAnswer } from './llm/AutoAnswer';
import type { ScreenshotService } from './screenshot/ScreenshotService';
import type { ReviewService } from './review/ReviewService';
import type { PracticeService } from './practice/PracticeService';

/**
 * Shared service registry. Services added in later milestones are declared optional
 * here so handlers can be registered before those services exist.
 */
export interface AppContext {
  paths: Paths;
  settings: SettingsStore;
  secrets: SecretStore;
  db: SessionDB;
  windows: WindowManager;
  hotkeys: HotkeyManager;
  sessions: SessionManager;
  audio: AudioManager;
  transcription: TranscriptionService;
  extension: ExtensionBridge;
  llm: LLMService;
  answers: AnswerEngine;
  auto: AutoAnswer;
  screenshots: ScreenshotService;
  review: ReviewService;
  practice: PracticeService;
  isDev: boolean;
  version: string;
}
