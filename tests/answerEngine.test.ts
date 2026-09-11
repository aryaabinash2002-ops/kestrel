import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AnswerEvent } from '@shared/types/ipc';
import type { AnswerCard, LatencySample, Utterance } from '@shared/types/session';
import { DEFAULT_SETTINGS } from '@shared/types/settings';
import { startFakeAnthropic, type FakeAnthropic } from './fakes/fakeAnthropic';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} } }));

const { LLMService } = await import('@main/llm/LLMService');
const { AnswerEngine } = await import('@main/llm/AnswerEngine');

let fake: FakeAnthropic;
beforeEach(async () => {
  fake = await startFakeAnthropic({ tokenDelayMs: 4, firstTokenDelayMs: 60 });
  process.env['KESTREL_ANTHROPIC_BASE_URL'] = fake.url;
});
afterEach(async () => {
  await fake.close();
  delete process.env['KESTREL_ANTHROPIC_BASE_URL'];
});

function harness() {
  const startedAt = Date.now() - 20000;
  const transcript: Utterance[] = [];
  const sessions = Object.assign(new EventEmitter(), {
    session: { id: 'sess_1', startedAt } as { id: string; startedAt: number } | null,
    activeProfile: null,
    sessionStartedAt: startedAt,
    nowMs: () => Date.now() - startedAt,
    finals: () => transcript.filter((u) => u.isFinal),
    all: () => transcript,
  });
  const saved: AnswerCard[] = [];
  const latency: LatencySample[] = [];
  const db = { saveAnswer: (c: AnswerCard) => saved.push({ ...c }), saveLatency: (s: LatencySample) => latency.push(s) };
  const secrets = { get: async () => 'test-key' };
  const llm = new LLMService(secrets as never);
  const engine = new AnswerEngine({ llm, sessions: sessions as never, db: db as never, getSettings: () => DEFAULT_SETTINGS });
  const events: AnswerEvent[] = [];
  engine.on('card', (e: AnswerEvent) => {
    if (e.type !== 'clear') events.push(e);
  });
  sessions.emit('started');
  return { engine, sessions, transcript, saved, latency, events, startedAt };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 4000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout');
    await wait(10);
  }
}

describe('AnswerEngine', () => {
  it('streams an answer: start → headline → deltas → done, with latency recorded', async () => {
    const { engine, events, saved, latency } = harness();
    const questionEndTs = Date.now() - 200;
    engine.requestAuto({ question: 'Tell me about a time you led a migration?', kind: 'auto', questionEndTs, speculative: true });
    await until(() => events.some((e) => e.type === 'done'));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types.indexOf('headline')).toBeGreaterThan(0);
    expect(types.indexOf('headline')).toBeLessThan(types.indexOf('done'));
    const done = events.find((e): e is Extract<AnswerEvent, { type: 'done' }> => e.type === 'done')!;
    expect(done.card.headline).toContain('Globex');
    expect(done.card.points).toHaveLength(4);
    expect(done.card.points[0]).toMatch(/^Situation/);
    expect(done.card.status).toBe('done');
    expect(done.card.latency.firstTokenTs).not.toBeNull();
    expect(done.card.latency.headlineDoneTs).toBeGreaterThanOrEqual(done.card.latency.firstTokenTs!);
    expect(done.card.latency.speculative).toBe(true);
    expect(saved).toHaveLength(1);
    expect(latency).toHaveLength(1);
    expect(latency[0]!.questionEndTs).toBe(questionEndTs);
    // Deltas are throttled to ~30/s: far fewer events than streamed tokens.
    expect(events.filter((e) => e.type === 'delta').length).toBeLessThan(40);
    // Request shape: fast path, strict format, system prefix present, live model.
    const req = fake.requests.find((r) => r.body.stream)!;
    expect(req.body.model).toBe(DEFAULT_SETTINGS.models.live);
    expect(req.body.max_tokens).toBe(350);
    expect(Array.isArray(req.body.system) && req.body.system[0]!.text).toContain('HEADLINE');
    expect(JSON.stringify(req.body.messages)).toContain('Question: Tell me about a time you led a migration?');
  });

  it('warms the connection at session start with a max_tokens=1 request', async () => {
    harness();
    await until(() => fake.requests.some((r) => r.body.max_tokens === 1));
    expect(fake.requests[0]!.body.max_tokens).toBe(1);
  });

  it('cancels an early in-flight answer when a newer question arrives, and aborts the HTTP stream', async () => {
    const { engine, events } = harness();
    engine.requestAuto({ question: 'What is your greatest strength?', kind: 'auto', questionEndTs: Date.now() });
    await until(() => events.some((e) => e.type === 'start'));
    await wait(80); // first token arrives, answer < 70 % done
    engine.requestAuto({ question: 'Tell me about a conflict with a coworker?', kind: 'auto', questionEndTs: Date.now() });
    await until(() => events.filter((e) => e.type === 'done').length >= 1, 6000);
    const cancelled = events.filter((e) => e.type === 'cancelled');
    expect(cancelled).toHaveLength(1);
    const dones = events.filter((e): e is Extract<AnswerEvent, { type: 'done' }> => e.type === 'done');
    expect(dones).toHaveLength(1);
    expect(dones[0]!.card.question).toContain('conflict');
    await wait(50);
    expect(fake.requests.filter((r) => r.body.stream && r.aborted)).toHaveLength(1);
  });

  it('ignores a re-detection of the same question while it streams', async () => {
    const { engine, events } = harness();
    engine.requestAuto({ question: 'Walk me through your resume', kind: 'auto', questionEndTs: Date.now() });
    await until(() => events.some((e) => e.type === 'start'));
    engine.requestAuto({ question: 'Walk me through your resume please', kind: 'auto', questionEndTs: Date.now() });
    await until(() => events.some((e) => e.type === 'done'));
    expect(events.filter((e) => e.type === 'start')).toHaveLength(1);
  });

  it('queues a new question when the current answer is ≥70 % done', async () => {
    const { engine, events } = harness();
    engine.requestAuto({ question: 'First question?', kind: 'auto', questionEndTs: Date.now() });
    // Wait until most of the answer has streamed.
    await until(() => engine.progress() >= 0.7, 6000);
    engine.requestAuto({ question: 'Completely different second question?', kind: 'auto', questionEndTs: Date.now() });
    await until(() => events.filter((e) => e.type === 'done').length === 2, 8000);
    expect(events.filter((e) => e.type === 'cancelled')).toHaveLength(0);
    const starts = events.filter((e): e is Extract<AnswerEvent, { type: 'start' }> => e.type === 'start');
    expect(starts.map((s) => s.card.question)).toEqual(['First question?', 'Completely different second question?']);
  });

  it('answerNow uses the last 30 s of THEM speech and overrides everything', async () => {
    const { engine, events, transcript, startedAt } = harness();
    const now = Date.now() - startedAt;
    transcript.push({ id: 'a', sessionId: 'sess_1', speaker: 'THEM', text: 'So next question.', startMs: now - 40000, endMs: now - 35000, isFinal: true, source: 'stt' });
    transcript.push({ id: 'b', sessionId: 'sess_1', speaker: 'THEM', text: 'Why do you want to work here?', startMs: now - 3000, endMs: now - 1000, isFinal: true, source: 'stt' });
    transcript.push({ id: 'c', sessionId: 'sess_1', speaker: 'ME', text: 'Well…', startMs: now - 900, endMs: now - 500, isFinal: true, source: 'stt' });
    engine.answerNow();
    await until(() => events.some((e) => e.type === 'done'));
    const start = events.find((e): e is Extract<AnswerEvent, { type: 'start' }> => e.type === 'start')!;
    expect(start.card.kind).toBe('manual');
    expect(start.card.question).toBe('Why do you want to work here?');
    expect(start.card.latency.questionEndTs).toBe(startedAt + now - 1000);
  });

  it('reports an error card on authentication failure', async () => {
    const startedAt = Date.now();
    const sessions = Object.assign(new EventEmitter(), {
      session: { id: 's', startedAt },
      activeProfile: null,
      sessionStartedAt: startedAt,
      nowMs: () => 0,
      finals: () => [],
      all: () => [],
    });
    const llm = new LLMService({ get: async () => 'bad-key' } as never);
    const engine = new AnswerEngine({ llm, sessions: sessions as never, db: { saveAnswer() {}, saveLatency() {} } as never, getSettings: () => DEFAULT_SETTINGS });
    const events: AnswerEvent[] = [];
    engine.on('card', (e: AnswerEvent) => events.push(e));
    sessions.emit('started');
    engine.requestAuto({ question: 'Anything?', kind: 'auto', questionEndTs: Date.now() });
    await until(() => events.some((e) => e.type === 'error'));
    const err = events.find((e): e is Extract<AnswerEvent, { type: 'error' }> => e.type === 'error')!;
    expect(err.error).toMatch(/401|invalid|authentication/i);
  });
});
