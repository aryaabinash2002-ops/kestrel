import type { Channel } from './session';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  groupId: string;
}

export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

export type CaptureSource = 'mic' | 'loopback' | 'device' | 'extension';

export interface ChannelStatus {
  channel: Channel;
  active: boolean;
  source: CaptureSource | null;
  deviceLabel: string | null;
  error: string | null;
  /** Warnings like 'bluetooth-headset', 'no-signal' */
  warnings: string[];
}

export interface AudioState {
  listening: boolean;
  me: ChannelStatus;
  them: ChannelStatus;
  /** Detected THEM source in 'auto' mode. */
  resolvedSystemMode: 'extension' | 'loopback' | 'device' | null;
}

export interface AudioLevel {
  channel: Channel;
  /** 0..1 RMS-ish level */
  level: number;
  ts: number;
}

/** Commands main sends to the hidden capture renderer. */
export type CaptureCommand =
  | { type: 'listDevices' }
  | {
      type: 'startMic';
      deviceId: string | null;
    }
  | { type: 'stopMic' }
  | { type: 'startLoopback' }
  | { type: 'startDevice'; deviceId: string }
  | { type: 'stopSystem' }
  | { type: 'ping' };

export interface CaptureRequest {
  id: number;
  cmd: CaptureCommand;
}

export interface CaptureReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Events the capture renderer pushes to main. */
export type CaptureEvent =
  | { type: 'level'; channel: Channel; level: number }
  | { type: 'devicechange' }
  | { type: 'trackEnded'; channel: Channel; reason: string }
  | { type: 'warning'; channel: Channel; warning: string }
  | { type: 'log'; message: string };

export const PCM_SAMPLE_RATE = 16000;
/** Target chunk length (ms) sent to main / providers. */
export const PCM_CHUNK_MS = 80;
