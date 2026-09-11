import { EventEmitter } from 'node:events';
import { release } from 'node:os';
import type { BrowserWindow } from 'electron';
import type {
  AudioDevices,
  AudioState,
  CaptureCommand,
  CaptureEvent,
  CaptureReply,
  ChannelStatus,
} from '@shared/types/audio';
import type { Channel } from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import { emit, onSend } from '../ipc';
import { logger } from '../logger';

const log = logger.scope('audio');

export interface PcmChunk {
  channel: Channel;
  /** PCM16 little-endian mono 16 kHz */
  pcm: Buffer;
  /** wall-clock ms when captured */
  ts: number;
  source: 'local' | 'extension';
}

type StartResult = { label: string; warnings: string[] };

/** True when this macOS build supports native system-audio loopback (14.2+). */
export function macSupportsLoopback(): boolean {
  if (process.platform !== 'darwin') return true;
  const [maj = '0', min = '0'] = release().split('.');
  const major = parseInt(maj, 10);
  const minor = parseInt(min, 10);
  return major > 23 || (major === 23 && minor >= 2);
}

/**
 * Main-process façade over the hidden capture renderer. Emits:
 *   'pcm'   (chunk: PcmChunk)
 *   'state' (state: AudioState)
 */
export class AudioManager extends EventEmitter {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private listening = false;
  private me: ChannelStatus = this.blank('ME');
  private them: ChannelStatus = this.blank('THEM');
  private resolvedSystemMode: AudioState['resolvedSystemMode'] = null;
  private extensionCapturing = false;
  private lastLevelEmit: Record<Channel, number> = { ME: 0, THEM: 0 };
  private lastLoudAt: Record<Channel, number> = { ME: 0, THEM: 0 };
  /** Meter level above which a channel counts as "speaking" (dBFS-mapped 0..1; speech ≈ 0.4–0.8). */
  static readonly SPEAKING_LEVEL = 0.28;
  private ready: Promise<void>;
  private readyResolve!: () => void;

  constructor(
    private getWindow: () => BrowserWindow | null,
    private getSettings: () => Settings,
  ) {
    super();
    this.ready = new Promise((r) => (this.readyResolve = r));
    onSend('capture:reply', (_e, reply) => this.onReply(reply));
    onSend('capture:event', (_e, ev) => this.onEvent(ev));
    onSend('capture:pcm', (_e, payload) => {
      if (!this.listening) return;
      const pcm = Buffer.isBuffer(payload.pcm)
        ? payload.pcm
        : payload.pcm instanceof ArrayBuffer
          ? Buffer.from(payload.pcm)
          : Buffer.from(
              (payload.pcm as Uint8Array).buffer,
              (payload.pcm as Uint8Array).byteOffset,
              (payload.pcm as Uint8Array).byteLength,
            );
      this.emit('pcm', {
        channel: payload.channel,
        pcm,
        ts: payload.ts,
        source: 'local',
      } satisfies PcmChunk);
    });
  }

  private blank(channel: Channel): ChannelStatus {
    return { channel, active: false, source: null, deviceLabel: null, error: null, warnings: [] };
  }

  /** Called by the window manager once the capture renderer has loaded. */
  markReady(): void {
    this.readyResolve();
  }

  state(): AudioState {
    return {
      listening: this.listening,
      me: { ...this.me },
      them: { ...this.them },
      resolvedSystemMode: this.resolvedSystemMode,
    };
  }

  private publish(): void {
    const s = this.state();
    emit('audio:state', s);
    this.emit('state', s);
  }

  // ----- request/reply bridge -----
  private request<T = unknown>(cmd: CaptureCommand, timeoutMs = 15000): Promise<T> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return Promise.reject(new Error('capture window not available'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`capture command ${cmd.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      win.webContents.send('capture:request', { id, cmd });
    });
  }

  private onReply(reply: CaptureReply): void {
    const p = this.pending.get(reply.id);
    if (!p) {
      log.warn('late capture reply dropped', reply.id, reply.ok ? 'ok' : reply.error);
      return;
    }
    this.pending.delete(reply.id);
    clearTimeout(p.timer);
    if (reply.ok) p.resolve(reply.result);
    else p.reject(new Error(reply.error ?? 'capture error'));
  }

  private onEvent(ev: CaptureEvent): void {
    switch (ev.type) {
      case 'level': {
        const now = Date.now();
        if (ev.level >= AudioManager.SPEAKING_LEVEL) this.lastLoudAt[ev.channel] = now;
        if (now - this.lastLevelEmit[ev.channel] < 60 && ev.level > 0) return;
        this.lastLevelEmit[ev.channel] = now;
        emit('audio:level', { channel: ev.channel, level: ev.level, ts: now });
        break;
      }
      case 'log':
        if (ev.message === 'capture renderer ready') this.markReady();
        log.debug('[capture]', ev.message);
        break;
      case 'devicechange':
        this.emit('devicechange');
        emit('toast', {
          kind: 'info',
          title: 'Audio devices changed',
          message: 'Check Settings → Audio if a device was unplugged.',
        });
        break;
      case 'trackEnded': {
        const st = ev.channel === 'ME' ? this.me : this.them;
        st.active = false;
        st.error = 'Track ended';
        log.warn(`${ev.channel} track ended: ${ev.reason}`);
        this.publish();
        if (this.listening) this.tryRestart(ev.channel);
        break;
      }
      case 'warning': {
        const st = ev.channel === 'ME' ? this.me : this.them;
        if (ev.warning === 'signal-restored')
          st.warnings = st.warnings.filter((w) => w !== 'no-signal');
        else if (!st.warnings.includes(ev.warning)) st.warnings.push(ev.warning);
        this.publish();
        break;
      }
    }
  }

  private restartTimers: Partial<Record<Channel, NodeJS.Timeout>> = {};
  private tryRestart(channel: Channel): void {
    if (this.restartTimers[channel]) return;
    this.restartTimers[channel] = setTimeout(async () => {
      delete this.restartTimers[channel];
      if (!this.listening) return;
      log.info(`restarting ${channel} capture`);
      try {
        await this.withCaptureVisible(() => (channel === 'ME' ? this.startMe() : this.startThem()));
      } catch (err) {
        log.warn(`restart ${channel} failed`, err);
      }
    }, 1500);
  }

  // ----- public API -----
  async listDevices(): Promise<AudioDevices> {
    await this.ready;
    // enumerateDevices may call getUserMedia once to obtain labels → needs visibility too.
    return this.withCaptureVisible(() => this.request<AudioDevices>({ type: 'listDevices' }));
  }

  /** Milliseconds since the channel was last above the speaking level (Infinity if never). */
  silenceMs(channel: Channel): number {
    const t = this.lastLoudAt[channel];
    return t ? Date.now() - t : Number.POSITIVE_INFINITY;
  }

  /** Extension bridge reports whether the Meet tab is streaming audio to us. */
  setExtensionCapturing(flag: boolean): void {
    if (this.extensionCapturing === flag) return;
    this.extensionCapturing = flag;
    if (this.listening && this.themEnabled) {
      const mode = this.getSettings().audio.systemAudioMode;
      if (mode === 'auto' || mode === 'extension')
        void this.withCaptureVisible(() => this.startThem());
    }
  }

  /** Feed PCM that arrived from the extension (THEM channel). */
  ingestExternal(channel: Channel, pcm: Buffer, ts: number): void {
    if (!this.listening || (channel === 'THEM' && !this.themEnabled)) return;
    if (channel === 'THEM' && this.resolvedSystemMode !== 'extension') return;
    const st = channel === 'ME' ? this.me : this.them;
    if (!st.active) {
      st.active = true;
      st.error = null;
      this.publish();
    }
    this.emit('pcm', { channel, pcm, ts, source: 'extension' } satisfies PcmChunk);
    // Level meter for extension audio (the capture renderer only meters local streams).
    const now = Date.now();
    if (now - this.lastLevelEmit[channel] >= 80) {
      this.lastLevelEmit[channel] = now;
      let sumSq = 0;
      const n = pcm.length >> 1;
      for (let i = 0; i < n; i++) {
        const s = pcm.readInt16LE(i * 2) / 32768;
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, n));
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      const lvl = Math.min(1, Math.max(0, (db + 50) / 40));
      if (lvl >= AudioManager.SPEAKING_LEVEL) this.lastLoudAt[channel] = now;
      emit('audio:level', { channel, level: lvl, ts: now });
    }
  }

  /** Practice mode captures the mic only (the TTS interviewer must not be heard as THEM). */
  private themEnabled = true;

  async start(opts: { them?: boolean } = {}): Promise<AudioState> {
    await this.ready;
    if (this.listening) return this.state();
    this.listening = true;
    this.themEnabled = opts.them !== false;
    log.info('start listening', this.themEnabled ? '(ME + THEM)' : '(ME only)');
    // Sequential: Chromium queues media requests per document, so parallel requests
    // just wait on each other and make the first one look slow.
    await this.withCaptureVisible(async () => {
      await this.startMe();
      if (this.themEnabled) await this.startThem();
      else {
        this.them = { ...this.blank('THEM'), deviceLabel: 'Off (practice mode)' };
        this.resolvedSystemMode = null;
      }
    });
    this.publish();
    return this.state();
  }

  /**
   * Chromium defers media requests for documents that were never shown. The capture
   * window is 1×1 and fully transparent, so showing it (inactive) is invisible to the
   * user; it is hidden again once streams are acquired — live streams keep running.
   */
  private async withCaptureVisible<T>(fn: () => Promise<T>): Promise<T> {
    const win = this.getWindow();
    const wasVisible = win?.isVisible() ?? false;
    if (win && !win.isDestroyed() && !wasVisible) win.showInactive();
    try {
      return await fn();
    } finally {
      if (win && !win.isDestroyed() && !wasVisible) win.hide();
    }
  }

  async stop(): Promise<AudioState> {
    if (!this.listening) return this.state();
    this.listening = false;
    for (const t of Object.values(this.restartTimers)) clearTimeout(t);
    this.restartTimers = {};
    await Promise.allSettled([
      this.request({ type: 'stopMic' }),
      this.request({ type: 'stopSystem' }),
    ]);
    this.me = this.blank('ME');
    this.them = this.blank('THEM');
    this.resolvedSystemMode = null;
    log.info('stopped listening');
    this.publish();
    return this.state();
  }

  private async startMe(): Promise<void> {
    const s = this.getSettings();
    this.me = { ...this.blank('ME'), source: 'mic' };
    try {
      const r = await this.request<StartResult>(
        { type: 'startMic', deviceId: s.audio.micDeviceId },
        30000,
      );
      this.me.active = true;
      this.me.deviceLabel = r.label;
      this.me.warnings = r.warnings;
      if (r.warnings.includes('bluetooth-headset')) {
        emit('toast', {
          kind: 'warning',
          title: 'Bluetooth headset in call mode',
          message: `${r.label} is using low-quality call audio. Use the laptop mic (or a wired headset) for better transcripts.`,
        });
      }
    } catch (err) {
      this.me.error = humanizeMicError(err);
      log.warn('mic start failed', err);
    }
    this.publish();
  }

  private async startThem(): Promise<void> {
    const s = this.getSettings();
    const mode = s.audio.systemAudioMode;
    // Stop any local capture first; it may be replaced by the extension.
    await this.request({ type: 'stopSystem' }).catch(() => undefined);
    this.them = this.blank('THEM');

    const useExtension = mode === 'extension' || (mode === 'auto' && this.extensionCapturing);
    if (useExtension) {
      this.resolvedSystemMode = 'extension';
      this.them.source = 'extension';
      this.them.active = this.extensionCapturing;
      this.them.deviceLabel = 'Google Meet tab (extension)';
      if (!this.extensionCapturing) this.them.error = 'Waiting for the Meet extension';
      this.publish();
      return;
    }

    const useDevice =
      mode === 'device' ||
      (mode === 'auto' && !macSupportsLoopback() && s.audio.systemInputDeviceId);
    if (useDevice) {
      this.resolvedSystemMode = 'device';
      this.them.source = 'device';
      if (!s.audio.systemInputDeviceId) {
        this.them.error = 'Pick a virtual input device in Settings → Audio';
      } else {
        try {
          const r = await this.request<StartResult>(
            { type: 'startDevice', deviceId: s.audio.systemInputDeviceId },
            30000,
          );
          this.them.active = true;
          this.them.deviceLabel = r.label;
        } catch (err) {
          this.them.error = humanizeMicError(err);
        }
      }
      this.publish();
      return;
    }

    this.resolvedSystemMode = 'loopback';
    this.them.source = 'loopback';
    if (!macSupportsLoopback()) {
      this.them.error =
        'System audio needs macOS 14.2+ — use BlackHole (virtual device) or the Meet extension';
      this.publish();
      return;
    }
    try {
      const r = await this.request<StartResult>({ type: 'startLoopback' }, 30000);
      this.them.active = true;
      this.them.deviceLabel = r.label;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('system-audio-permission')) {
        this.them.error = 'System Audio Recording permission missing';
        emit('toast', {
          kind: 'error',
          title: 'System audio permission missing',
          message:
            process.platform === 'darwin'
              ? 'Enable Kestrel under Privacy & Security → Screen & System Audio Recording → System Audio Recording Only, then restart Kestrel.'
              : 'Kestrel could not capture system audio.',
          sticky: true,
        });
      } else if (msg.includes('no-system-audio')) {
        this.them.error = 'No system audio track';
      } else if (/Invalid capture constraints|AbortError/.test(msg)) {
        this.them.error =
          'No screen source for system audio (screen locked, or Screen Recording denied) — retry or use the Meet extension';
      } else {
        this.them.error = msg.replace(/^NotAllowedError: /, 'Blocked: ');
      }
      log.warn('loopback start failed', msg);
    }
    this.publish();
  }

  /** Sample the level of a channel for ~3 s. Starts capture temporarily if needed. */
  async test(channel: Channel): Promise<{ ok: boolean; peak: number; message: string }> {
    const wasListening = this.listening;
    if (!wasListening) await this.start();
    const st = channel === 'ME' ? this.me : this.them;
    if (st.error) {
      if (!wasListening) await this.stop();
      return { ok: false, peak: 0, message: st.error };
    }
    let peak = 0;
    const listener = (_e: unknown, ev: CaptureEvent) => {
      if (ev.type === 'level' && ev.channel === channel) peak = Math.max(peak, ev.level);
    };
    const { ipcMain } = await import('electron');
    ipcMain.on('capture:event', listener);
    await new Promise((r) => setTimeout(r, 3200));
    ipcMain.off('capture:event', listener);
    if (!wasListening) await this.stop();
    const ok = peak > 0.05;
    return {
      ok,
      peak,
      message: ok
        ? `Signal detected (peak ${Math.round(peak * 100)}%)`
        : channel === 'ME'
          ? 'No microphone signal — check the input device and macOS/Windows mic permission.'
          : 'No system audio detected — play something and make sure the app’s speaker device matches what Kestrel captures.',
    };
  }
}

function humanizeMicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/NotAllowedError|Permission denied|permission/i.test(msg))
    return 'Microphone permission denied';
  if (/NotFoundError|Requested device not found/i.test(msg)) return 'Microphone not found';
  if (/NotReadableError|Could not start/i.test(msg)) return 'Microphone busy (used by another app)';
  return msg;
}
