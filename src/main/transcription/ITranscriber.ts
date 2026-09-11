import { EventEmitter } from 'node:events';
import type { Channel } from '@shared/types/session';
import type { TranscriberStatus, TranscriptionState } from '@shared/types/transcription';
import { logger } from '../logger';

export interface TranscriberOptions {
  channel: Channel;
  apiKey: string;
  /** BCP-47 code or 'multi' */
  language: string;
  sampleRate: number;
  /** Optional domain terms to boost (company names, tech). */
  keyterms?: string[];
  /** Override the WebSocket base URL (used by tests). */
  endpoint?: string;
}

/**
 * Events:
 *   'result'       (r: TranscriptResult)
 *   'utteranceEnd' (endWallMs: number)
 *   'speechStarted'(wallMs: number)
 *   'state'        (s: TranscriptionState)
 */
export interface ITranscriber extends EventEmitter {
  readonly provider: string;
  readonly channel: Channel;
  readonly status: TranscriberStatus;
  /** Number of automatic reconnects so far (diagnostics). */
  readonly reconnects: number;
  connect(): Promise<void>;
  /** Send a PCM16 mono chunk at the configured sample rate. */
  send(pcm: Buffer): void;
  /** Ask the provider to flush/finalize the current utterance. */
  finalize(): void;
  close(): Promise<void>;
  state(): TranscriptionState;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
/** Audio kept while a socket is (re)connecting, then replayed. */
const REPLAY_BUFFER_MS = 3000;

/**
 * Shared plumbing for WebSocket streaming providers: status, reconnect with backoff,
 * replay buffer for audio captured during a reconnect, keep-alive when audio pauses.
 */
export abstract class BaseTranscriber extends EventEmitter implements ITranscriber {
  abstract readonly provider: string;
  readonly channel: Channel;
  protected log = logger.scope('stt');
  private _status: TranscriberStatus = 'idle';
  protected closing = false;
  protected reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  protected lastAudioSentAt = 0;
  private replay: Buffer[] = [];
  private replayBytes = 0;
  private readonly replayMaxBytes: number;
  /** Wall-clock ms corresponding to provider audio time 0 for the current connection. */
  protected audioEpochMs = 0;
  protected bytesSent = 0;
  private lastMessage = '';
  public reconnects = 0;

  constructor(protected opts: TranscriberOptions) {
    super();
    this.channel = opts.channel;
    this.replayMaxBytes = Math.round((opts.sampleRate * 2 * REPLAY_BUFFER_MS) / 1000);
  }

  get status(): TranscriberStatus {
    return this._status;
  }

  state(): TranscriptionState {
    return {
      channel: this.channel,
      status: this._status,
      provider: this.provider,
      message: this.lastMessage || undefined,
      reconnectAttempt: this.reconnectAttempt || undefined,
    };
  }

  protected setStatus(status: TranscriberStatus, message = ''): void {
    if (this._status === status && this.lastMessage === message) return;
    this._status = status;
    this.lastMessage = message;
    this.emit('state', this.state());
  }

  // ----- to implement per provider -----
  protected abstract openSocket(): Promise<void>;
  protected abstract sendAudio(pcm: Buffer): void;
  protected abstract sendKeepAlive(): void;
  protected abstract closeSocket(): Promise<void>;
  abstract finalize(): void;

  async connect(): Promise<void> {
    this.closing = false;
    this.setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting');
    try {
      await this.openSocket();
      this.reconnectAttempt = 0;
      this.setStatus('open');
      this.startKeepAlive();
      this.flushReplay();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`${this.provider}/${this.channel} connect failed: ${msg}`);
      if (/40[13]|unauthor|invalid.*key|forbidden/i.test(msg)) {
        this.setStatus('error', 'Invalid API key');
        throw err;
      }
      this.scheduleReconnect(msg);
    }
  }

  /** Called by providers when the socket closed unexpectedly. */
  protected onSocketClosed(reason: string): void {
    this.stopKeepAlive();
    if (this.closing) {
      this.setStatus('closed');
      return;
    }
    this.log.warn(`${this.provider}/${this.channel} socket closed: ${reason}`);
    this.scheduleReconnect(reason);
  }

  private scheduleReconnect(reason: string): void {
    if (this.closing || this.reconnectTimer) return;
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)] ?? 15000;
    this.reconnectAttempt++;
    this.reconnects++;
    this.setStatus('reconnecting', reason);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  send(pcm: Buffer): void {
    if (this.closing) return;
    if (this._status === 'open') {
      if (this.bytesSent === 0) this.audioEpochMs = Date.now();
      this.bytesSent += pcm.length;
      this.lastAudioSentAt = Date.now();
      this.sendAudio(pcm);
    } else {
      this.replay.push(pcm);
      this.replayBytes += pcm.length;
      while (this.replayBytes > this.replayMaxBytes && this.replay.length) {
        const dropped = this.replay.shift();
        this.replayBytes -= dropped?.length ?? 0;
      }
    }
  }

  private flushReplay(): void {
    if (!this.replay.length) return;
    const chunks = this.replay;
    const ms = (this.replayBytes / (this.opts.sampleRate * 2)) * 1000;
    this.replay = [];
    this.replayBytes = 0;
    // The replayed audio is older than "now": shift the epoch back so timings stay right.
    this.audioEpochMs = Date.now() - ms;
    for (const c of chunks) {
      this.bytesSent += c.length;
      this.sendAudio(c);
    }
    this.lastAudioSentAt = Date.now();
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this._status !== 'open') return;
      if (Date.now() - this.lastAudioSentAt > 4000) {
        try {
          this.sendKeepAlive();
        } catch (err) {
          this.log.debug('keepalive failed', err);
        }
      }
    }, 2000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  /** Provider audio seconds → wall-clock ms. */
  protected toWallMs(seconds: number): number {
    return Math.round(this.audioEpochMs + seconds * 1000);
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopKeepAlive();
    this.replay = [];
    this.replayBytes = 0;
    await this.closeSocket().catch(() => undefined);
    this.setStatus('closed');
  }
}
