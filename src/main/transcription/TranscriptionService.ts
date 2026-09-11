import { EventEmitter } from 'node:events';
import type { Channel, Utterance } from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import type { TranscriberStats, TranscriptResult, TranscriptionState } from '@shared/types/transcription';
import { uid } from '@shared/utils';
import type { AudioManager, PcmChunk } from '../audio/AudioManager';
import type { SessionManager } from '../session/SessionManager';
import type { SecretStore } from '../secrets';
import { emit } from '../ipc';
import { logger } from '../logger';
import { EchoFilter } from './EchoFilter';
import type { ITranscriber, TranscriberOptions } from './ITranscriber';
import { DeepgramTranscriber } from './DeepgramTranscriber';
import { AssemblyAITranscriber } from './AssemblyAITranscriber';

const log = logger.scope('transcription');

/** Rolling state of the utterance being built for one channel. */
interface Build {
  id: string | null;
  finals: string;
  interim: string;
  startWallMs: number | null;
  endWallMs: number;
  lastResultAt: number;
}

export interface InterimEvent {
  channel: Channel;
  /** finals-so-far + current interim */
  text: string;
  /** wall ms of the last word heard */
  lastWordWallMs: number;
  receivedAt: number;
  isFinalSegment: boolean;
}

export interface FinalEvent {
  channel: Channel;
  utterance: Utterance;
  lastWordWallMs: number;
}

/** ME finals are held briefly so THEM results from the same moment can be compared. */
const ME_HOLD_MS = 600;
/** Close an utterance if the provider goes quiet for this long without speech_final. */
const STALE_UTTERANCE_MS = 2500;

export type TranscriberFactory = (opts: TranscriberOptions, provider: Settings['transcriber']) => ITranscriber;

export const defaultTranscriberFactory: TranscriberFactory = (opts, provider) =>
  provider === 'assemblyai' ? new AssemblyAITranscriber(opts) : new DeepgramTranscriber(opts);

/**
 * Owns one transcriber per channel for the active session, turns provider results into
 * `Utterance`s (interim + final), applies the echo filter and feeds the SessionManager.
 *
 * Events: 'interim' (InterimEvent), 'final' (FinalEvent), 'utteranceEnd' ({channel, wallMs}),
 *         'speechStarted' ({channel, wallMs}), 'state' (TranscriptionState)
 */
export class TranscriptionService extends EventEmitter {
  private transcribers: Partial<Record<Channel, ITranscriber>> = {};
  private builds: Record<Channel, Build> = { ME: this.blank(), THEM: this.blank() };
  private echo = new EchoFilter();
  private meHold: { u: Utterance; timer: NodeJS.Timeout; lastWordWallMs: number }[] = [];
  private stats: Record<Channel, { interimCount: number; finalCount: number; gapSum: number; lastInterimAt: number }> = {
    ME: { interimCount: 0, finalCount: 0, gapSum: 0, lastInterimAt: 0 },
    THEM: { interimCount: 0, finalCount: 0, gapSum: 0, lastInterimAt: 0 },
  };
  private staleTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private sessions: SessionManager,
    private audio: AudioManager,
    private secrets: SecretStore,
    private getSettings: () => Settings,
    private factory: TranscriberFactory = defaultTranscriberFactory,
  ) {
    super();
    audio.on('pcm', (chunk: PcmChunk) => this.onPcm(chunk));
    sessions.on('started', () => void this.start());
    sessions.on('ended', () => void this.stop());
  }

  private blank(): Build {
    return { id: null, finals: '', interim: '', startWallMs: null, endWallMs: 0, lastResultAt: 0 };
  }

  /** Set when a session is running but transcription could not start (e.g. missing key). */
  private startError: string | null = null;

  states(): TranscriptionState[] {
    const provider = this.getSettings().transcriber;
    return (['ME', 'THEM'] as Channel[]).map(
      (c) =>
        this.transcribers[c]?.state() ??
        (this.startError
          ? { channel: c, status: 'error', provider, message: this.startError }
          : { channel: c, status: 'idle', provider }),
    );
  }

  statsSnapshot(): TranscriberStats[] {
    return (['ME', 'THEM'] as Channel[]).map((c) => {
      const s = this.stats[c];
      return {
        channel: c,
        interimCount: s.interimCount,
        finalCount: s.finalCount,
        avgInterimGapMs: s.interimCount > 1 ? s.gapSum / (s.interimCount - 1) : 0,
        reconnects: this.transcribers[c]?.reconnects ?? 0,
      };
    });
  }

  /** Open both provider sockets now (not when speech starts) so the first words are not lost. */
  async start(): Promise<void> {
    if (this.running) return;
    const settings = this.getSettings();
    const provider = settings.transcriber;
    const apiKey = await this.secrets.get(provider);
    if (!apiKey) {
      this.startError = 'No API key';
      emit('toast', {
        kind: 'error',
        title: `No ${provider === 'deepgram' ? 'Deepgram' : 'AssemblyAI'} API key`,
        message: 'Add it in Settings → Keys to enable live transcription.',
        sticky: true,
      });
      for (const s of this.states()) emit('transcription:state', s);
      return;
    }
    this.startError = null;
    this.running = true;
    this.echo.reset();
    this.builds = { ME: this.blank(), THEM: this.blank() };
    for (const c of ['ME', 'THEM'] as Channel[]) {
      // KESTREL_STT_ENDPOINT lets developers point the app at a fake/local server.
      const endpoint = process.env['KESTREL_STT_ENDPOINT'] || undefined;
      const t = this.factory(
        { channel: c, apiKey, language: settings.transcriptionLanguage, sampleRate: 16000, keyterms: this.keyterms(), endpoint },
        provider,
      );
      t.on('result', (r: TranscriptResult) => this.onResult(r));
      t.on('utteranceEnd', (wallMs: number) => this.onUtteranceEnd(c, wallMs));
      t.on('speechStarted', (wallMs: number) => this.emit('speechStarted', { channel: c, wallMs }));
      t.on('state', (s: TranscriptionState) => {
        emit('transcription:state', s);
        this.emit('state', s);
        if (s.status === 'error') {
          emit('toast', { kind: 'error', title: `Transcription (${c}) error`, message: s.message, sticky: true });
        }
      });
      this.transcribers[c] = t;
      void t.connect();
    }
    this.staleTimer = setInterval(() => this.closeStale(), 500);
    log.info(`transcription started (${provider})`);
  }

  async stop(): Promise<void> {
    this.startError = null;
    if (!this.running) return;
    this.running = false;
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = null;
    for (const h of this.meHold) {
      clearTimeout(h.timer);
      this.commitMe(h.u, h.lastWordWallMs);
    }
    this.meHold = [];
    for (const c of ['ME', 'THEM'] as Channel[]) this.closeUtterance(c, Date.now(), true);
    const ts = Object.values(this.transcribers);
    this.transcribers = {};
    await Promise.allSettled(ts.map((t) => t.close()));
    for (const c of ['ME', 'THEM'] as Channel[]) {
      emit('transcription:state', { channel: c, status: 'idle', provider: this.getSettings().transcriber });
    }
    log.info('transcription stopped');
  }

  private keyterms(): string[] {
    const p = this.sessions.activeProfile;
    if (!p) return [];
    return [p.company, p.role].filter((s) => s && s.length > 2 && s.length < 40).slice(0, 10);
  }

  private onPcm(chunk: PcmChunk): void {
    this.transcribers[chunk.channel]?.send(chunk.pcm);
  }

  // ----- utterance building -----
  private onResult(r: TranscriptResult): void {
    const b = this.builds[r.channel];
    const st = this.stats[r.channel];
    if (r.isFinal) st.finalCount++;
    else {
      st.interimCount++;
      if (st.lastInterimAt) st.gapSum += r.receivedAt - st.lastInterimAt;
      st.lastInterimAt = r.receivedAt;
    }
    if (!b.id) {
      b.id = uid('utt');
      b.startWallMs = r.startWallMs;
    }
    b.lastResultAt = r.receivedAt;
    if (r.text) b.endWallMs = Math.max(b.endWallMs, r.endWallMs);
    if (r.isFinal) {
      if (r.text) b.finals = b.finals ? `${b.finals} ${r.text}` : r.text;
      b.interim = '';
    } else {
      b.interim = r.text;
    }
    const text = [b.finals, b.interim].filter(Boolean).join(' ');
    if (r.channel === 'THEM' && text) this.echo.noteThem(text, r.receivedAt);
    if (text) {
      emit('transcript:interim', { channel: r.channel, text });
      this.emit('interim', {
        channel: r.channel,
        text,
        lastWordWallMs: b.endWallMs,
        receivedAt: r.receivedAt,
        isFinalSegment: r.isFinal,
      } satisfies InterimEvent);
    }
    if (r.speechFinal) this.closeUtterance(r.channel, b.endWallMs);
  }

  private onUtteranceEnd(channel: Channel, wallMs: number): void {
    const b = this.builds[channel];
    if (b.id && (b.finals || b.interim)) this.closeUtterance(channel, wallMs || b.endWallMs);
    this.emit('utteranceEnd', { channel, wallMs });
  }

  private closeStale(): void {
    const now = Date.now();
    for (const c of ['ME', 'THEM'] as Channel[]) {
      const b = this.builds[c];
      if (b.id && b.finals && now - b.lastResultAt > STALE_UTTERANCE_MS) {
        this.transcribers[c]?.finalize();
        this.closeUtterance(c, b.endWallMs);
      }
    }
  }

  private closeUtterance(channel: Channel, lastWordWallMs: number, flushInterim = false): void {
    const b = this.builds[channel];
    if (!b.id) return;
    const text = (flushInterim ? [b.finals, b.interim].filter(Boolean).join(' ') : b.finals).trim();
    const session = this.sessions.session;
    this.builds[channel] = this.blank();
    emit('transcript:interim', { channel, text: '' });
    if (!text || !session) return;
    const startedAt = this.sessions.sessionStartedAt;
    const u: Utterance = {
      id: b.id,
      sessionId: session.id,
      speaker: channel,
      text,
      startMs: Math.max(0, (b.startWallMs ?? lastWordWallMs) - startedAt),
      endMs: Math.max(0, lastWordWallMs - startedAt),
      isFinal: true,
      source: 'stt',
    };
    if (channel === 'ME' && this.audio.state().them.active) {
      // Hold so a simultaneous THEM result can be compared for echo.
      const timer = setTimeout(() => {
        this.meHold = this.meHold.filter((h) => h.u.id !== u.id);
        this.commitMe(u, lastWordWallMs);
      }, ME_HOLD_MS);
      this.meHold.push({ u, timer, lastWordWallMs });
      return;
    }
    this.commit(u, lastWordWallMs);
  }

  private commitMe(u: Utterance, lastWordWallMs: number): void {
    if (this.echo.isEcho(u.text, lastWordWallMs)) {
      log.debug('dropped ME echo:', u.text);
      return;
    }
    this.commit(u, lastWordWallMs);
  }

  private commit(u: Utterance, lastWordWallMs: number): void {
    this.sessions.pushUtterance(u);
    this.emit('final', { channel: u.speaker as Channel, utterance: u, lastWordWallMs } satisfies FinalEvent);
  }

  /** Inject a caption-derived utterance (extension fallback). */
  pushExternalUtterance(channel: Channel, text: string, speakerName: string | undefined, isFinal: boolean): void {
    const session = this.sessions.session;
    if (!session || !text.trim()) return;
    const now = Date.now();
    if (channel === 'THEM') this.echo.noteThem(text, now);
    const u: Utterance = {
      id: uid('cap'),
      sessionId: session.id,
      speaker: channel,
      text: text.trim(),
      startMs: Math.max(0, now - 1500 - this.sessions.sessionStartedAt),
      endMs: Math.max(0, now - this.sessions.sessionStartedAt),
      isFinal,
      source: 'captions',
      speakerName,
    };
    if (isFinal) this.commit(u, now);
    else {
      emit('transcript:interim', { channel, text: u.text });
      this.emit('interim', { channel, text: u.text, lastWordWallMs: now, receivedAt: now, isFinalSegment: false } satisfies InterimEvent);
    }
  }
}
