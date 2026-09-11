/** Wire protocol between the Chrome extension and the desktop app (local WebSocket). */

export interface ExtensionPairingInfo {
  port: number;
  token: string;
  url: string;
}

export type ExtensionStatus = 'off' | 'listening' | 'paired' | 'capturing';

export interface ExtensionState {
  status: ExtensionStatus;
  clientName: string | null;
  inCall: boolean;
  captionsAvailable: boolean;
  lastAudioAt: number | null;
  port: number;
}

/** JSON messages from extension → app. Audio is sent as binary frames (PCM16 16 kHz mono). */
export type ExtensionToAppMessage =
  | { type: 'hello'; token: string; client: string; version: string }
  | { type: 'call'; state: 'joined' | 'left'; url?: string }
  | { type: 'capture'; state: 'started' | 'stopped' }
  | { type: 'caption'; speaker: string; text: string; ts: number; isFinal: boolean }
  | { type: 'ping'; ts: number };

export type AppToExtensionMessage =
  | { type: 'welcome'; appVersion: string; sessionActive: boolean }
  | { type: 'error'; code: 'bad-token' | 'busy'; message: string }
  | { type: 'pong'; ts: number }
  | { type: 'session'; active: boolean }
  | { type: 'request-capture'; start: boolean };
