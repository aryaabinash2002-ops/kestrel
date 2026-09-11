import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Utterance } from '@shared/types/session';
import type { TranscriptResult } from '@shared/types/transcription';
import { DEFAULT_SETTINGS } from '@shared/types/settings';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
}));

const { TranscriptionService } = await import('@main/transcription/TranscriptionService');
type ITranscriber = import('@main/transcription/ITranscriber').ITranscriber;

class FakeTranscriber extends EventEmitter implements ITranscriber {
  provider = 'fake';
  status: 'idle' | 'open' | 'closed' = 'idle';
  reconnects = 0;
  sent: Buffer[] = [];
  constructor(public channel: 'ME' | 'THEM') {
    super();
  }
  async connect() {
    this.status = 'open';
  }
  send(pcm: Buffer) {
    this.sent.push(pcm);
  }
  finalize() {}
  async close() {
    this.status = 'closed';
  }
  state() {
    return { channel: this.channel, status: this.status, provider: this.provider };
  }
  result(r: Partial<TranscriptResult> & { text: string }) {
    const now = Date.now();
    this.emit('result', {
      channel: this.channel,
      isFinal: false,
      speechFinal: false,
      startWallMs: now - 1000,
      endWallMs: now,
      receivedAt: now,
      ...r,
    } satisfies TranscriptResult);
  }
}

function harness() {
  const startedAt = Date.now() - 5000;
  const pushed: Utterance[] = [];
  const sessions = Object.assign(new EventEmitter(), {
    session: { id: 'sess_1', startedAt },
    activeProfile: null,
    sessionStartedAt: startedAt,
    pushUtterance: (u: Utterance) => pushed.push(u),
  });
  const audio = Object.assign(new EventEmitter(), { state: () => ({ them: { active: true } }) });
  const secrets = { get: async () => 'key' };
  const fakes: Partial<Record<'ME' | 'THEM', FakeTranscriber>> = {};
  const svc = new TranscriptionService(
    sessions as never,
    audio as never,
    secrets as never,
    () => DEFAULT_SETTINGS,
    (opts) => (fakes[opts.channel] = new FakeTranscriber(opts.channel)),
  );
  return { svc, sessions, audio, pushed, fakes };
}

describe('TranscriptionService', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('builds utterances from interim + final segments and commits on speech_final', async () => {
    const { svc, pushed, fakes, audio } = harness();
    const interims: string[] = [];
    svc.on(
      'interim',
      (e: { channel: string; text: string }) => e.channel === 'THEM' && interims.push(e.text),
    );
    await svc.start();
    audio.emit('pcm', { channel: 'THEM', pcm: Buffer.alloc(10), ts: Date.now(), source: 'local' });
    expect(fakes.THEM!.sent).toHaveLength(1);

    fakes.THEM!.result({ text: 'tell me' });
    fakes.THEM!.result({ text: 'Tell me about', isFinal: true });
    fakes.THEM!.result({ text: 'a time you' });
    fakes.THEM!.result({ text: 'a time you failed.', isFinal: true, speechFinal: true });
    expect(interims).toEqual([
      'tell me',
      'Tell me about',
      'Tell me about a time you',
      'Tell me about a time you failed.',
    ]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.text).toBe('Tell me about a time you failed.');
    expect(pushed[0]?.speaker).toBe('THEM');
    expect(pushed[0]?.isFinal).toBe(true);
    expect(pushed[0]?.startMs).toBeGreaterThan(0);
    await svc.stop();
  });

  it('drops ME utterances that echo THEM (speakers, no headphones)', async () => {
    const { svc, pushed, fakes } = harness();
    await svc.start();
    fakes.THEM!.result({
      text: 'What is your greatest weakness?',
      isFinal: true,
      speechFinal: true,
    });
    fakes.ME!.result({ text: 'what is your greatest weakness', isFinal: true, speechFinal: true });
    fakes.ME!.result({
      text: 'I would say I take on too much sometimes',
      isFinal: true,
      speechFinal: true,
    });
    await vi.advanceTimersByTimeAsync(700); // ME hold
    expect(pushed.map((u) => `${u.speaker}:${u.text}`)).toEqual([
      'THEM:What is your greatest weakness?',
      'ME:I would say I take on too much sometimes',
    ]);
    await svc.stop();
  });

  it('closes an utterance on UtteranceEnd when no speech_final arrived', async () => {
    const { svc, pushed, fakes } = harness();
    await svc.start();
    fakes.THEM!.result({ text: 'Walk me through your resume', isFinal: true });
    expect(pushed).toHaveLength(0);
    fakes.THEM!.emit('utteranceEnd', Date.now());
    expect(pushed).toHaveLength(1);
    await svc.stop();
  });
});
