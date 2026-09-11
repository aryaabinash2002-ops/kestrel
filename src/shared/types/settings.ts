export type Theme = 'dark' | 'light' | 'system';
export type AnswerLength = 'short' | 'medium' | 'detailed';
export type Tone = 'confident' | 'casual' | 'formal';
export type InterviewType = 'behavioral' | 'technical' | 'system_design' | 'sales' | 'general';
export type TranscriberProvider = 'deepgram' | 'assemblyai';
/** How the THEM channel is captured. */
export type SystemAudioMode = 'auto' | 'extension' | 'loopback' | 'device';

export type SecretKey = 'anthropic' | 'deepgram' | 'assemblyai';

export type HotkeyName =
  'toggleListening' | 'answerNow' | 'screenshotSolve' | 'togglePanel' | 'clearCards';

export type HotkeyBindings = Record<HotkeyName, string>;

export type PromptName =
  | 'live_answer'
  | 'classifier'
  | 'screenshot_solve'
  | 'practice_interviewer'
  | 'practice_scorer'
  | 'review'
  | 'summary';

export interface Settings {
  version: 1;
  onboardingDone: boolean;
  consentAcknowledged: boolean;
  transcriber: TranscriberProvider;
  transcriptionLanguage: string;
  models: {
    /** Fast model on the live path. */
    live: string;
    /** Stronger model for screenshots / coding / review. */
    heavy: string;
    /** Model for the JSON question classifier + summaries. */
    classifier: string;
  };
  audio: {
    micDeviceId: string | null;
    systemAudioMode: SystemAudioMode;
    /** Used when systemAudioMode === 'device' (BlackHole / virtual input). */
    systemInputDeviceId: string | null;
  };
  hotkeys: HotkeyBindings;
  autoAnswer: boolean;
  smalltalkAnswers: boolean;
  defaults: {
    length: AnswerLength;
    tone: Tone;
    language: string;
    codeLanguage: string;
  };
  ui: {
    theme: Theme;
    opacity: number;
    fontSize: number;
    compact: boolean;
    alwaysOnTop: boolean;
    showLatency: boolean;
    /** See-through panel: transparent window with a frosted, translucent background (text stays opaque). */
    glass: boolean;
    /** Background opacity in glass mode (0.2–0.95). */
    glassAlpha: number;
  };
  extensionPort: number;
  /** Start a session + listening automatically when the extension reports a joined Meet call. */
  autoStartOnMeetJoin: boolean;
  /** Profile used for the last session (auto-started sessions reuse it). */
  lastProfileId: string | null;
  /** Custom data folder (null = app userData). */
  dataDir: string | null;
  /** User overrides of the built-in prompt templates. */
  prompts: Partial<Record<PromptName, string>>;
}

export const DEFAULT_HOTKEYS: HotkeyBindings = {
  toggleListening: 'CommandOrControl+Shift+L',
  answerNow: 'CommandOrControl+Shift+A',
  screenshotSolve: 'CommandOrControl+Shift+S',
  togglePanel: 'CommandOrControl+Shift+K',
  clearCards: 'CommandOrControl+Shift+X',
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  onboardingDone: false,
  consentAcknowledged: false,
  transcriber: 'deepgram',
  transcriptionLanguage: 'multi',
  models: {
    live: 'claude-haiku-4-5-20251001',
    heavy: 'claude-sonnet-5',
    classifier: 'claude-haiku-4-5-20251001',
  },
  audio: {
    micDeviceId: null,
    systemAudioMode: 'auto',
    systemInputDeviceId: null,
  },
  hotkeys: DEFAULT_HOTKEYS,
  autoAnswer: true,
  smalltalkAnswers: false,
  defaults: {
    length: 'short',
    tone: 'confident',
    language: 'English',
    codeLanguage: 'Python',
  },
  ui: {
    theme: 'dark',
    opacity: 1,
    fontSize: 14,
    compact: false,
    alwaysOnTop: true,
    showLatency: false,
    glass: true,
    glassAlpha: 0.7,
  },
  extensionPort: 47600,
  autoStartOnMeetJoin: true,
  lastProfileId: null,
  dataDir: null,
  prompts: {},
};
