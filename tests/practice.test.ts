import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { PracticeEvent } from '@shared/types/ipc';
import { DEFAULT_SETTINGS } from '@shared/types/settings';
import { startFakeAnthropic, type FakeAnthropic } from './fakes/fakeAnthropic';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const { SessionDB } = await import('@main/db');
const { LLMService } = await import('@main/llm/LLMService');
const { PracticeService, SCORE_SCHEMA } = await import('@main/practice/PracticeService');
const { STATIC_BANKS, pickStatic } = await import('@main/practice/questionBank');

let fake: FakeAnthropic;
beforeEach(async () => {
  fake = await startFakeAnthropic({ tokenDelayMs: 2, firstTokenDelayMs: 10 });
  process.env['KESTREL_ANTHROPIC_BASE_URL'] = fake.url;
});
afterEach(async () => {
  await fake.close();
  delete process.env['KESTREL_ANTHROPIC_BASE_URL'];
});

function harness() {
  const db = new SessionDB(':memory:');
  type Sess = { id: string; profileId: string | null; mode: string; startedAt: number; endedAt: number | null; summary: null };
  let current: Sess | null = null;
  let listening = false;
  class FakeSessions extends EventEmitter {
    get session(): Sess | null {
      return current;
    }
    get activeProfile(): null {
      return null;
    }
    start(profileId: string | null, mode: 'live' | 'practice') {
      current = db.createSession(profileId, mode);
      return { session: current, profile: null, listening };
    }
    stop() {
      if (current) db.endSession(current.id);
      const ended = current;
      current = null;
      listening = false;
      if (ended) this.emit('ended', ended);
      return { session: null, profile: null, listening };
    }
    setListening(f: boolean) {
      listening = f;
    }
    state() {
      return { session: current, profile: null, listening };
    }
  }
  const sessions = new FakeSessions();
  const audioCalls: string[] = [];
  const audio = {
    start: async (opts?: { them?: boolean }) => {
      audioCalls.push(`start:${opts?.them === false ? 'me' : 'both'}`);
      return {} as never;
    },
    stop: async () => {
      audioCalls.push('stop');
      return {} as never;
    },
  };
  const transcription = new EventEmitter();
  const llm = new LLMService({ get: async () => 'key' } as never);
  const svc = new PracticeService({ llm, db, sessions: sessions as never, audio: audio as never, transcription: transcription as never, getSettings: () => DEFAULT_SETTINGS });
  const events: PracticeEvent[] = [];
  svc.on('event', (e: PracticeEvent) => events.push(e));
  return { svc, db, sessions, audioCalls, events, getListening: () => listening };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, timeout = 5000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout');
    await wait(10);
  }
}

describe('question bank', () => {
  it('has sizeable static banks and picks unique questions', () => {
    expect(STATIC_BANKS.behavioral.questions.length).toBeGreaterThanOrEqual(20);
    expect(STATIC_BANKS.coding.questions.length).toBeGreaterThanOrEqual(12);
    expect(STATIC_BANKS.system_design.questions.length).toBeGreaterThanOrEqual(10);
    const picked = pickStatic('coding', 5, 42);
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((q) => q.question)).size).toBe(5);
    expect(picked.every((q) => q.category === 'coding')).toBe(true);
    expect(pickStatic('behavioral', 3, 7)[0]?.question).toBe('Tell me about yourself.');
  });

  it('scorer schema mirrors PracticeScore.score', () => {
    expect(SCORE_SCHEMA.required).toEqual(['score', 'relevance', 'structure', 'specificity', 'conciseness', 'strengths', 'improve_one_thing', 'model_answer']);
    expect(SCORE_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('PracticeService', () => {
  it('lists the four question sets', async () => {
    const { svc } = harness();
    const sets = await svc.sets(null);
    expect(sets.map((s) => s.id)).toEqual(['behavioral', 'role', 'coding', 'system_design']);
    expect(sets[1]!.description).toMatch(/job description/i);
  });

  it('starts a mic-only practice session and asks the first question of the chosen set', async () => {
    const { svc, events, audioCalls, sessions, getListening } = harness();
    const state = await svc.start({ profileId: null, setId: 'coding', count: 3, useTts: false });
    expect(state.session?.mode).toBe('practice');
    expect(audioCalls).toEqual(['start:me']);
    expect(getListening()).toBe(true);
    expect(sessions.session?.id).toBe(state.session?.id);
    const q = events.find((e): e is Extract<PracticeEvent, { type: 'question' }> => e.type === 'question')!;
    expect(q).toMatchObject({ index: 0, total: 3, category: 'coding' });
    expect(STATIC_BANKS.coding.questions).toContain(q.question);
    await svc.stop();
  });

  it('scores a submitted answer, stores it, emits score then the next question; finishes and stops audio/session', async () => {
    const { svc, events, db, audioCalls, sessions } = harness();
    const state = await svc.start({ profileId: null, setId: 'behavioral', count: 2, useTts: false });
    const sid = state.session!.id;
    await svc.submit('At Globex I led the billing migration to Stripe with zero downtime.');
    const types = events.map((e) => e.type);
    expect(types).toEqual(['question', 'scoring', 'score', 'question']);
    const score = events.find((e): e is Extract<PracticeEvent, { type: 'score' }> => e.type === 'score')!.score;
    expect(score.score.score).toBe(7);
    expect(score.score.strengths).toEqual(['Clear outcome']);
    expect(score.score.model_answer).toContain('Globex');
    expect(score.sessionId).toBe(sid);
    expect(db.listPracticeScores(sid)).toHaveLength(1);
    expect(db.listPracticeScores(sid)[0]!.answer).toContain('billing migration');
    const second = events.filter((e): e is Extract<PracticeEvent, { type: 'question' }> => e.type === 'question')[1]!;
    expect(second.index).toBe(1);
    // The scorer request carried the strict JSON schema and the question/answer.
    const scoreReq = fake.requests.find((r) => JSON.stringify(r.body.output_config ?? {}).includes('improve_one_thing'))!;
    expect(scoreReq.body.model).toBe(DEFAULT_SETTINGS.models.heavy);
    expect(JSON.stringify(scoreReq.body.messages)).toContain('billing migration');

    await svc.submit('Second answer with a number: 40% fewer errors.');
    await until(() => events.some((e) => e.type === 'finished'));
    expect(audioCalls).toEqual(['start:me', 'stop']);
    expect(sessions.session).toBeNull();
    expect(db.getSession(sid)?.endedAt).not.toBeNull();
    expect(svc.active).toBe(false);
  });

  it('skip moves on without scoring and rejects empty answers', async () => {
    const { svc, events, db } = harness();
    const state = await svc.start({ profileId: null, setId: 'system_design', count: 2, useTts: true });
    await svc.submit('   ');
    expect(events.some((e) => e.type === 'error')).toBe(true);
    await svc.skip();
    const qs = events.filter((e) => e.type === 'question');
    expect(qs).toHaveLength(2);
    expect(db.listPracticeScores(state.session!.id)).toHaveLength(0);
    await svc.skip();
    expect(events.some((e) => e.type === 'finished')).toBe(true);
  });

  it('falls back to behavioral questions for the role set when generation returns nothing', async () => {
    const { svc, db, events } = harness();
    const p = db.saveProfile({ name: 'P', role: 'SRE', company: 'Acme', jdText: 'We need an SRE who owns reliability.', resumeText: 'Jane, SRE.' });
    await svc.start({ profileId: p.id, setId: 'role', count: 2, useTts: false });
    const q = events.find((e): e is Extract<PracticeEvent, { type: 'question' }> => e.type === 'question')!;
    expect(q.category).toBe('behavioral');
    // A generation request was attempted with the {questions} schema.
    expect(fake.requests.some((r) => JSON.stringify(r.body.output_config ?? {}).includes('"questions"'))).toBe(true);
    await svc.stop();
  });

  it('aggregates history per profile', async () => {
    const { svc, db } = harness();
    const p = db.saveProfile({ name: 'P' });
    await svc.start({ profileId: p.id, setId: 'behavioral', count: 1, useTts: false });
    await svc.submit('An answer.');
    await until(() => !svc.active);
    const h = svc.history(p.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ count: 1, avgScore: 7 });
    expect(h[0]!.scores[0]!.score.score).toBe(7);
    expect(svc.history('nope')).toHaveLength(0);
  });
});
