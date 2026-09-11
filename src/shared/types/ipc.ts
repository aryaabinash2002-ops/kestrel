import type {
  AudioDevices,
  AudioLevel,
  AudioState,
  CaptureEvent,
  CaptureReply,
  CaptureRequest,
} from './audio';
import type { ExtensionPairingInfo, ExtensionState } from './extension';
import type {
  AnswerCard,
  LatencySample,
  PracticeScore,
  Profile,
  QuestionType,
  ScreenshotResult,
  Session,
  SessionMode,
  SessionSummary,
  Utterance,
} from './session';
import type { HotkeyName, PromptName, SecretKey, Settings } from './settings';
import type { TranscriptionState } from './transcription';

export type Platform =
  | 'darwin'
  | 'win32'
  | 'linux'
  | 'aix'
  | 'android'
  | 'freebsd'
  | 'haiku'
  | 'openbsd'
  | 'sunos'
  | 'cygwin'
  | 'netbsd';

export interface AppInfo {
  version: string;
  platform: Platform;
  arch: string;
  userDataPath: string;
  dataDir: string;
  isDev: boolean;
  electron: string;
  macOSVersion: string | null;
}

export interface SessionState {
  session: Session | null;
  profile: Profile | null;
  listening: boolean;
}

export type AnswerEvent =
  | { type: 'start'; card: AnswerCard }
  | {
      type: 'delta';
      id: string;
      text: string;
      headline: string;
      points: string[];
      content: string;
      stale?: boolean;
    }
  | { type: 'headline'; id: string; headline: string; ts: number }
  | { type: 'done'; id: string; card: AnswerCard }
  | { type: 'cancelled'; id: string; reason: string }
  | { type: 'error'; id: string; error: string }
  | {
      type: 'classified';
      id: string;
      isQuestion: boolean;
      questionType: QuestionType;
      question: string;
    }
  | { type: 'chip'; id: string; question: string }
  | { type: 'clear' };

export type ScreenshotEvent =
  | { type: 'start'; result: ScreenshotResult }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string; result: ScreenshotResult }
  | { type: 'error'; id: string; error: string };

export type PracticeEvent =
  | { type: 'question'; index: number; total: number; question: string; category: string }
  | { type: 'listening'; question: string }
  | { type: 'scoring' }
  | { type: 'score'; score: PracticeScore }
  | { type: 'finished' }
  | { type: 'error'; error: string };

export interface Toast {
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  id?: string;
  sticky?: boolean;
}

export interface QuestionDetected {
  text: string;
  speculative: boolean;
  ts: number;
}

export interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  screen: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
}

export interface ReviewExportResult {
  path: string;
}

export interface ParsedDocument {
  text: string;
  filename: string;
  pages?: number;
  chars: number;
}

export interface PracticeQuestionSet {
  id: string;
  label: string;
  description: string;
}

export interface PracticeHistoryEntry {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  count: number;
  avgScore: number;
  scores: PracticeScore[];
}

export interface DiagnosticsData {
  latency: LatencySample[];
  transcriberStats: {
    channel: string;
    interimCount: number;
    finalCount: number;
    avgInterimGapMs: number;
  }[];
  speculativeRestartRate: number;
  cache?: { cached: boolean; prefixTokens: number; cacheMinimum: number } | null;
}

/**
 * Renderer → main request/response channels.
 * `args` is the tuple of arguments, `result` the resolved value.
 */
export interface IpcInvokeMap {
  'app:info': { args: []; result: AppInfo };
  'app:openExternal': { args: [url: string]; result: void };
  'app:openPath': { args: [path: string]; result: void };
  'app:permissions': { args: []; result: PermissionStatus };
  'app:requestMicPermission': { args: []; result: boolean };
  'app:openPrivacySettings': { args: [pane: 'microphone' | 'screen' | 'audio']; result: void };
  'app:deleteAllData': { args: []; result: void };
  'app:chooseDataDir': { args: []; result: string | null };
  'app:hotkeyTrigger': { args: [name: HotkeyName]; result: void };

  'settings:get': { args: []; result: Settings };
  'settings:set': { args: [patch: DeepPartial<Settings>]; result: Settings };
  'settings:resetPrompt': { args: [name: PromptName]; result: Settings };
  'settings:defaultPrompt': { args: [name: PromptName]; result: string };

  'secrets:set': { args: [key: SecretKey, value: string]; result: void };
  'secrets:delete': { args: [key: SecretKey]; result: void };
  'secrets:status': { args: []; result: Record<SecretKey, boolean> };
  'secrets:test': { args: [key: SecretKey]; result: { ok: boolean; message: string } };
  'secrets:backend': { args: []; result: 'keychain' | 'safeStorage' | 'plain' };

  'window:setAlwaysOnTop': { args: [flag: boolean]; result: void };
  'window:setOpacity': { args: [opacity: number]; result: void };
  'window:minimize': { args: []; result: void };
  'window:close': { args: []; result: void };
  'window:setCompact': { args: [compact: boolean]; result: void };
  'window:togglePanel': { args: []; result: void };

  'audio:listDevices': { args: []; result: AudioDevices };
  'audio:start': { args: []; result: AudioState };
  'audio:stop': { args: []; result: AudioState };
  'audio:state': { args: []; result: AudioState };
  'audio:test': {
    args: [channel: 'ME' | 'THEM'];
    result: { ok: boolean; peak: number; message: string };
  };

  'session:start': {
    args: [opts: { profileId: string | null; mode: SessionMode }];
    result: SessionState;
  };
  'session:stop': { args: []; result: SessionState };
  'session:state': { args: []; result: SessionState };
  'session:list': {
    args: [];
    result: (Session & {
      profileName: string | null;
      utteranceCount: number;
      answerCount: number;
    })[];
  };
  'session:delete': { args: [sessionId: string]; result: void };

  'transcript:get': { args: [sessionId: string]; result: Utterance[] };
  'transcript:state': { args: []; result: TranscriptionState[] };

  'answer:now': { args: []; result: void };
  'answer:cancel': { args: [id?: string]; result: void };
  'answer:clear': { args: []; result: void };
  'answer:chat': { args: [text: string]; result: void };
  'answer:list': { args: [sessionId: string]; result: AnswerCard[] };
  'answer:current': { args: []; result: AnswerCard[] };
  'llm:warm': { args: []; result: void };

  'profiles:list': { args: []; result: Profile[] };
  'profiles:get': { args: [id: string]; result: Profile | null };
  'profiles:save': { args: [profile: Partial<Profile> & { id?: string }]; result: Profile };
  'profiles:delete': { args: [id: string]; result: void };
  'profiles:parseDocument': {
    args: [source: { path?: string; base64?: string; filename: string }];
    result: ParsedDocument;
  };
  'profiles:pickDocument': { args: []; result: ParsedDocument | null };

  'screenshot:solve': { args: [opts: { region: boolean }]; result: void };
  'screenshot:list': { args: [sessionId: string]; result: ScreenshotResult[] };
  'screenshot:cancel': { args: []; result: void };

  'review:generate': { args: [sessionId: string]; result: SessionSummary };
  'review:export': { args: [sessionId: string, format: 'md' | 'pdf']; result: ReviewExportResult };

  'practice:sets': { args: [profileId: string | null]; result: PracticeQuestionSet[] };
  'practice:start': {
    args: [opts: { profileId: string | null; setId: string; count: number; useTts: boolean }];
    result: SessionState;
  };
  'practice:submit': { args: [answerText: string]; result: void };
  'practice:skip': { args: []; result: void };
  'practice:stop': { args: []; result: void };
  'practice:history': { args: [profileId: string | null]; result: PracticeHistoryEntry[] };
  'practice:speak': { args: [text: string]; result: void };

  'extension:pairing': { args: []; result: ExtensionPairingInfo };
  'extension:state': { args: []; result: ExtensionState };
  'extension:regenerateToken': { args: []; result: ExtensionPairingInfo };
  'extension:openFolder': { args: []; result: string };

  'diagnostics:get': { args: []; result: DiagnosticsData };
  'diagnostics:clear': { args: []; result: void };
}

/** Main → renderer push events. */
export interface IpcEventMap {
  'settings:changed': Settings;
  'audio:state': AudioState;
  'audio:level': AudioLevel;
  'session:state': SessionState;
  'transcript:utterance': Utterance;
  'transcript:interim': { channel: 'ME' | 'THEM'; text: string };
  'transcription:state': TranscriptionState;
  'question:detected': QuestionDetected;
  'answer:event': AnswerEvent;
  'screenshot:event': ScreenshotEvent;
  'practice:event': PracticeEvent;
  'extension:state': ExtensionState;
  hotkey: { name: HotkeyName };
  toast: Toast;
  navigate: { to: string };
  'latency:sample': LatencySample;
}

/** Fire-and-forget renderer → main messages. */
export interface IpcSendMap {
  'capture:pcm': { channel: 'ME' | 'THEM'; ts: number; pcm: ArrayBuffer };
  'capture:reply': CaptureReply;
  'capture:event': CaptureEvent;
  'region:selected': {
    x: number;
    y: number;
    width: number;
    height: number;
    displayId: number;
  } | null;
}

/** Main → capture-renderer messages. */
export interface IpcCaptureMap {
  'capture:request': CaptureRequest;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? T[K] extends Array<unknown>
      ? T[K]
      : DeepPartial<T[K]>
    : T[K];
};

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;
export type IpcSendChannel = keyof IpcSendMap;

/** The API exposed on `window.kestrel` by the preload script. */
export interface KestrelApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: IpcInvokeMap[C]['args']
  ): Promise<IpcInvokeMap[C]['result']>;
  on<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventMap[C]) => void,
  ): () => void;
  send<C extends IpcSendChannel>(channel: C, payload: IpcSendMap[C]): void;
  platform: Platform;
}

/** The API exposed on `window.kestrelCapture` in the hidden capture renderer. */
export interface KestrelCaptureApi {
  onRequest(listener: (req: CaptureRequest) => void): () => void;
  reply(reply: CaptureReply): void;
  event(ev: CaptureEvent): void;
  pcm(channel: 'ME' | 'THEM', ts: number, pcm: ArrayBuffer): void;
}
