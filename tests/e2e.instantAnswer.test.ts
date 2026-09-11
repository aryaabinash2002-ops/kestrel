/**
 * End-to-end: recorded audio fixture → (fake) Deepgram streaming → TranscriptionService →
 * QuestionDetector → speculative answer streamed from a (fake) Anthropic server, with the
 * classifier running in parallel. Verifies the §5 pipeline and §7 latency behaviour.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnswerEvent } from '@shared/types/ipc';
import type { AnswerCard, LatencySample, Utterance } from '@shared/types/session';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings';
import { FakeDeepgramServer } from './fakes/fakeDeepgram';
import { startFakeAnthropic, type FakeAnthropic } from './fakes/fakeAnthropic';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
}));

const { TranscriptionService } = await import('@main/transcription/TranscriptionService');
const { DeepgramTranscriber } = await import('@main/transcription/DeepgramTranscriber');
const { LLMService } = await import('@main/llm/LLMService');
const { AnswerEngine } = await import('@main/llm/AnswerEngine');
const { Classifier } = await import('@main/llm/Classifier');
const { AutoAnswer } = await import('@main/llm/AutoAnswer');
type ITranscriber = import('@main/transcription/ITranscriber').ITranscriber;

class SilentTranscriber extends EventEmitter implements ITranscriber {
  provider = 'silent';
  status = 'open' as const;
  reconnects = 0;
  constructor(public channel: 'ME' | 'THEM') {
    super();
  }
  async connect() {}
  send() {}
  finalize() {}
  async close() {}
  state() {
    return { channel: this.channel, status: this.status, provider: this.provider };
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 6000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting');
    await wait(10);
  }
}

let dg: FakeDeepgramServer;
let llmServer: FakeAnthropic;
beforeEach(async () => {
  dg = await FakeDeepgramServer.start();
  llmServer = await startFakeAnthropic({ tokenDelayMs: 5, firstTokenDelayMs: 150 });
  process.env['KESTREL_ANTHROPIC_BASE_URL'] = llmServer.url;
});
afterEach(async () => {
  await dg.close();
  await llmServer.close();
  delete process.env['KESTREL_ANTHROPIC_BASE_URL'];
});

function pipeline(settingsPatch: Partial<Settings> = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...settingsPatch };
  const startedAt = Date.now();
  const transcript: Utterance[] = [];
  const sessions = Object.assign(new EventEmitter(), {
    session: {
      id: 'sess_e2e',
      startedAt,
      profileId: null,
      mode: 'live',
      endedAt: null,
      summary: null,
    },
    activeProfile: null,
    sessionStartedAt: startedAt,
    nowMs: () => Date.now() - startedAt,
    finals: () => transcript.filter((u) => u.isFinal),
    all: () => transcript,
    pushUtterance: (u: Utterance) => {
      const i = transcript.findIndex((x) => x.id === u.id);
      if (i >= 0) transcript[i] = u;
      else transcript.push(u);
    },
  });
  const audio = Object.assign(new EventEmitter(), { state: () => ({ them: { active: true } }) });
  const secrets = { get: async () => 'key' };
  const transcription = new TranscriptionService(
    sessions as never,
    audio as never,
    secrets as never,
    () => settings,
    (opts) =>
      opts.channel === 'THEM'
        ? new DeepgramTranscriber({ ...opts, endpoint: dg.url })
        : new SilentTranscriber(opts.channel),
  );
  const saved: AnswerCard[] = [];
  const latency: LatencySample[] = [];
  const db = {
    saveAnswer: (c: AnswerCard) => saved.push({ ...c }),
    saveLatency: (s: LatencySample) => latency.push(s),
  };
  const llm = new LLMService(secrets as never);
  const engine = new AnswerEngine({
    llm,
    sessions: sessions as never,
    db: db as never,
    getSettings: () => settings,
  });
  const auto = new AutoAnswer(
    transcription,
    sessions as never,
    engine,
    new Classifier(llm, () => settings),
    () => settings,
  );
  const events: AnswerEvent[] = [];
  engine.on('card', (e: AnswerEvent) => e.type !== 'clear' && events.push(e));
  return {
    sessions,
    audio,
    transcription,
    engine,
    auto,
    events,
    saved,
    latency,
    transcript,
    startedAt,
  };
}

/** Stream the WAV fixture in real time (80 ms chunks) through the audio emitter. */
function streamFixture(audio: EventEmitter): { bytes: number; done: Promise<void> } {
  const wav = readFileSync(resolve(__dirname, 'fixtures/question.wav'));
  const pcm = wav.subarray(44);
  const chunk = 2560;
  let off = 0;
  const done = new Promise<void>((r) => {
    const t = setInterval(() => {
      if (off >= pcm.length) {
        clearInterval(t);
        r();
        return;
      }
      audio.emit('pcm', {
        channel: 'THEM',
        pcm: pcm.subarray(off, off + chunk),
        ts: Date.now(),
        source: 'local',
      });
      off += chunk;
    }, 80);
  });
  return { bytes: pcm.length, done };
}

describe('instant answer pipeline (E2E)', () => {
  it('answers speculatively before the final transcript, keeps it when the final matches, and labels it', async () => {
    const p = pipeline();
    p.sessions.emit('started');
    await until(() => dg.clients.length === 1); // only THEM connects to the fake Deepgram
    const { bytes, done } = streamFixture(p.audio);

    // Scripted results timed like a real 3.2 s question; interims arrive every ~250 ms
    // (Deepgram cadence), i.e. faster than the 350 ms stability window.
    await wait(600);
    dg.results('can you tell me', { start: 0.2, end: 0.9 });
    await wait(250);
    dg.results('can you tell me about a', { start: 0.2, end: 1.2 });
    await wait(250);
    dg.results('can you tell me about a time you', { start: 0.2, end: 1.6 });
    await wait(250);
    dg.results('can you tell me about a time you led a', { start: 0.2, end: 2.0 });
    await wait(250);
    dg.results('can you tell me about a time you led a difficult migration', {
      start: 0.2,
      end: 2.6,
    });
    // 350 ms of stability → speculative start.
    await until(() => p.events.some((e) => e.type === 'start'), 1500);
    const startEvent = p.events.find(
      (e): e is Extract<AnswerEvent, { type: 'start' }> => e.type === 'start',
    )!;
    expect(startEvent.card.latency.speculative).toBe(true);
    expect(p.transcript.filter((u) => u.isFinal)).toHaveLength(0); // no final yet: truly speculative
    const finalSentAt = Date.now();
    dg.results('Can you tell me about a time you led a difficult migration?', {
      isFinal: true,
      speechFinal: true,
      start: 0.2,
      end: 3.0,
    });
    await done;
    await until(() => p.events.some((e) => e.type === 'done'));
    // The final matched (≥80 % overlap): no restart, no cancellation, single card.
    expect(p.events.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(p.events.filter((e) => e.type === 'cancelled')).toHaveLength(0);
    const doneEv = p.events.find(
      (e): e is Extract<AnswerEvent, { type: 'done' }> => e.type === 'done',
    )!;
    expect(doneEv.card.headline).toContain('Globex');
    expect(doneEv.card.points.length).toBeGreaterThanOrEqual(3);
    // First token came before or within 1 s of the question's end.
    const ft = doneEv.card.latency.firstTokenTs!;
    expect(ft).toBeLessThan(finalSentAt + 1000);
    // The classifier ran in parallel and labelled the card without delaying it.
    await until(() => p.events.some((e) => e.type === 'classified'));
    const cls = p.events.find(
      (e): e is Extract<AnswerEvent, { type: 'classified' }> => e.type === 'classified',
    )!;
    expect(cls.questionType).toBe('behavioral');
    expect(cls.isQuestion).toBe(true);
    // Transcript persisted through the session manager, audio fully delivered to the provider.
    const finals = p.transcript.filter((u) => u.isFinal);
    expect(finals).toHaveLength(1);
    expect(finals[0]!.text).toBe('Can you tell me about a time you led a difficult migration?');
    expect(finals[0]!.speaker).toBe('THEM');
    await until(() => dg.bytesReceived >= bytes);
    expect(p.latency).toHaveLength(1);
    expect(p.latency[0]!.speculative).toBe(true);
    // Both request kinds hit the LLM: warm-up (max_tokens 1), the streamed answer, the JSON classifier.
    const kinds = llmServer.requests.map((r) =>
      r.body.max_tokens === 1 ? 'warm' : r.body.stream ? 'answer' : 'classify',
    );
    expect(kinds).toContain('warm');
    expect(kinds).toContain('answer');
    expect(kinds).toContain('classify');
    p.sessions.emit('ended');
    await p.transcription.stop();
  });

  it('restarts the answer when the final question changes meaningfully', async () => {
    const p = pipeline();
    p.sessions.emit('started');
    await until(() => dg.clients.length === 1);
    dg.results('what would you do if a deploy failed', { start: 0, end: 1.5 });
    await until(() => p.events.some((e) => e.type === 'start'), 1500);
    await wait(200);
    dg.results(
      'What would you do if a deploy failed at 2 a.m., the on-call engineer is unreachable and customers are down?',
      { isFinal: true, speechFinal: true, start: 0, end: 4.5 },
    );
    await until(() => p.events.some((e) => e.type === 'done'), 8000);
    const starts = p.events.filter(
      (e): e is Extract<AnswerEvent, { type: 'start' }> => e.type === 'start',
    );
    expect(starts).toHaveLength(2);
    expect(starts[1]!.card.id).toBe(starts[0]!.card.id); // swapped in place
    expect(starts[1]!.card.latency.restarted).toBe(true);
    expect(starts[1]!.card.question).toContain('customers are down');
    expect(p.events.filter((e) => e.type === 'cancelled')).toHaveLength(1);
    expect(p.engine.restarts).toBe(1);
    p.sessions.emit('ended');
    await p.transcription.stop();
  });

  it('does not answer statements, and turns smalltalk into a chip', async () => {
    const p = pipeline({ smalltalkAnswers: false });
    p.sessions.emit('started');
    await until(() => dg.clients.length === 1);
    dg.results('okay great thanks for that', { start: 0, end: 1 });
    dg.results('Okay great, thanks for that.', {
      isFinal: true,
      speechFinal: true,
      start: 0,
      end: 1.2,
    });
    await wait(600);
    expect(p.events.filter((e) => e.type === 'start')).toHaveLength(0);

    dg.results('how are you doing today', { start: 2, end: 3 });
    await until(() => p.events.some((e) => e.type === 'start'), 1500); // heuristic fires…
    dg.results('How are you doing today?', {
      isFinal: true,
      speechFinal: true,
      start: 2,
      end: 3.1,
    });
    await until(() => p.events.some((e) => e.type === 'chip'), 4000); // …the classifier vetoes it into a chip
    const chip = p.events.find(
      (e): e is Extract<AnswerEvent, { type: 'chip' }> => e.type === 'chip',
    )!;
    expect(chip.question.toLowerCase()).toContain('how are you');
    expect(p.engine.current().filter((c) => c.status === 'done')).toHaveLength(0);
    p.sessions.emit('ended');
    await p.transcription.stop();
  });
});
