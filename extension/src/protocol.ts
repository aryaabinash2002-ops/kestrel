/** Messages between the extension's own parts (popup ⇄ background ⇄ offscreen ⇄ content). */
import type { AppToExtensionMessage } from '@shared/types/extension';

export interface StoredSettings {
  token: string;
  port: number;
  autoCapture: boolean;
}

export const DEFAULT_SETTINGS: StoredSettings = { token: '', port: 47600, autoCapture: true };

export interface ExtStatus {
  connection: 'disconnected' | 'connecting' | 'connected' | 'bad-token' | 'error';
  capturing: boolean;
  tabId: number | null;
  inCall: boolean;
  captionsSeen: boolean;
  sessionActive: boolean;
  lastError: string | null;
  appVersion: string | null;
}

export type ExtMessage =
  // popup/command → background
  | { type: 'get-status' }
  | { type: 'start-capture'; tabId?: number }
  | { type: 'stop-capture' }
  | { type: 'settings-updated' }
  | { type: 'test-connection' }
  // background → offscreen
  | { type: 'offscreen-start'; streamId: string; token: string; port: number; tabId: number }
  | { type: 'offscreen-stop' }
  | { type: 'offscreen-connect'; token: string; port: number }
  | { type: 'offscreen-forward'; payload: unknown }
  // offscreen → background
  | { type: 'offscreen-status'; status: Partial<ExtStatus> }
  | { type: 'app-message'; message: AppToExtensionMessage }
  // content → background
  | { type: 'meet-call'; state: 'joined' | 'left'; url: string }
  | { type: 'meet-caption'; speaker: string; text: string; ts: number; isFinal: boolean }
  // background → content
  | { type: 'meet-query' };

export async function loadSettings(): Promise<StoredSettings> {
  const raw = (await chrome.storage.local.get('settings')) as { settings?: Partial<StoredSettings> };
  return { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
}

export async function saveSettings(patch: Partial<StoredSettings>): Promise<StoredSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
