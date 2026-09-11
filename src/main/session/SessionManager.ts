import { EventEmitter } from 'node:events';
import type { Profile, Session, SessionMode, Utterance } from '@shared/types/session';
import type { SessionState } from '@shared/types/ipc';
import type { SessionDB } from '../db';
import { emit } from '../ipc';
import { logger } from '../logger';

const log = logger.scope('session');

/**
 * Owns the currently active session (live or practice) and the rolling transcript.
 * Audio/transcription/LLM services subscribe to it; it does not know about them.
 */
export class SessionManager extends EventEmitter {
  private current: Session | null = null;
  private profile: Profile | null = null;
  private listening = false;
  /** In-memory transcript for the active session (finals + latest interim per channel). */
  private transcript: Utterance[] = [];

  constructor(private db: SessionDB) {
    super();
  }

  get session(): Session | null {
    return this.current;
  }
  get activeProfile(): Profile | null {
    return this.profile;
  }
  get isListening(): boolean {
    return this.listening;
  }
  get sessionStartedAt(): number {
    return this.current?.startedAt ?? Date.now();
  }

  state(): SessionState {
    return { session: this.current, profile: this.profile, listening: this.listening };
  }

  start(profileId: string | null, mode: SessionMode): SessionState {
    if (this.current) this.stop();
    this.profile = profileId ? this.db.getProfile(profileId) : null;
    this.current = this.db.createSession(this.profile?.id ?? null, mode);
    this.transcript = [];
    log.info('session started', this.current.id, mode, this.profile?.name ?? '(no profile)');
    this.emitState();
    this.emit('started', this.current, this.profile);
    return this.state();
  }

  stop(): SessionState {
    const s = this.current;
    if (!s) return this.state();
    this.db.endSession(s.id);
    this.current = null;
    this.setListening(false);
    log.info('session ended', s.id);
    this.emitState();
    const ended: Session = { ...s, endedAt: Date.now() };
    const profile = this.profile;
    this.profile = null;
    this.emit('ended', ended, profile);
    return this.state();
  }

  setListening(flag: boolean): void {
    if (this.listening === flag) return;
    this.listening = flag;
    this.emitState();
    this.emit('listening', flag);
  }

  private emitState(): void {
    emit('session:state', this.state());
  }

  /** Persist + broadcast an utterance (interim or final). */
  pushUtterance(u: Utterance): void {
    if (!this.current || u.sessionId !== this.current.id) return;
    const idx = this.transcript.findIndex((x) => x.id === u.id);
    if (idx >= 0) this.transcript[idx] = u;
    else this.transcript.push(u);
    if (this.transcript.length > 2000) this.transcript.splice(0, this.transcript.length - 2000);
    if (u.isFinal) this.db.upsertUtterance(u);
    emit('transcript:utterance', u);
    this.emit('utterance', u);
  }

  removeUtterance(id: string): void {
    this.transcript = this.transcript.filter((x) => x.id !== id);
    this.db.deleteUtterance(id);
  }

  /** Final utterances of the active session, oldest first. */
  finals(): Utterance[] {
    return this.transcript.filter((u) => u.isFinal);
  }

  /** All utterances (including interims), oldest first. */
  all(): Utterance[] {
    return this.transcript.slice();
  }

  /** Final utterances whose end is within the last `windowMs` of session time. */
  recent(windowMs: number, speaker?: Utterance['speaker']): Utterance[] {
    const nowMs = Date.now() - this.sessionStartedAt;
    return this.transcript.filter(
      (u) => u.isFinal && nowMs - u.endMs <= windowMs && (!speaker || u.speaker === speaker),
    );
  }

  /** Milliseconds since the session started. */
  nowMs(): number {
    return Date.now() - this.sessionStartedAt;
  }
}
