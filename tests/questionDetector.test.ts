import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  QuestionDetector,
  looksLikeQuestion,
  type DetectedQuestion,
  type QuestionUpdate,
} from '@main/detection/QuestionDetector';

describe('looksLikeQuestion (§5.3 heuristic)', () => {
  it.each([
    'Tell me about yourself',
    'Can you walk me through your résumé',
    'what is your greatest weakness',
    'So, how would you design a URL shortener',
    "Let's talk about your last role",
    'Take me through the architecture',
    'Describe a time you failed.',
    'Why should we hire you',
    'Any questions for us',
    'You mentioned Kafka?',
    'Give me an example of leadership',
  ])('detects: %s', (t) => expect(looksLikeQuestion(t)).toBe(true));

  it.each([
    'Great, thanks.',
    'Okay so next we will move on to the coding part.',
    'That makes sense.',
    'Hi',
    'Sounds good, thank you',
  ])('ignores: %s', (t) => expect(looksLikeQuestion(t)).toBe(false));

  it('is fast', () => {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++)
      looksLikeQuestion(
        'So can you walk me through a time when you had to handle a difficult stakeholder and what happened',
      );
    expect((performance.now() - t0) / 2000).toBeLessThan(0.05); // ms per call
  });
});

describe('QuestionDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const d = new QuestionDetector({ stableMs: 350 });
    const questions: DetectedQuestion[] = [];
    const updates: QuestionUpdate[] = [];
    const statements: unknown[] = [];
    d.on('question', (q: DetectedQuestion) => questions.push(q));
    d.on('update', (u: QuestionUpdate) => updates.push(u));
    d.on('statement', (s: unknown) => statements.push(s));
    return { d, questions, updates, statements };
  }

  it('starts speculatively after 350 ms of stable question-like interim text and keeps it on a matching final', () => {
    const { d, questions, updates } = make();
    d.interim('tell me', 1000);
    vi.advanceTimersByTime(200);
    d.interim('tell me about a time', 1400);
    vi.advanceTimersByTime(300);
    expect(questions).toHaveLength(0); // text changed 300 ms ago: not stable yet
    d.interim('tell me about a time you failed', 1900);
    vi.advanceTimersByTime(349);
    expect(questions).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      text: 'tell me about a time you failed',
      speculative: true,
      questionEndTs: 1900,
    });
    d.final('Tell me about a time you failed.', 2100);
    expect(questions).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ restart: false, speculative: false, questionEndTs: 2100 });
    expect(updates[0]!.overlap).toBeGreaterThanOrEqual(0.8);
  });

  it('restarts when the final adds meaningfully to the question', () => {
    const { d, questions, updates } = make();
    d.interim('tell me about a time you failed', 1000);
    vi.advanceTimersByTime(350);
    expect(questions).toHaveLength(1);
    d.final(
      'Tell me about a time you failed and what was the result and how did the team react',
      2500,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ restart: true, speculative: false, questionEndTs: 2500 });
    expect(updates[0]!.overlap).toBeLessThan(0.8);
  });

  it('treats continued speech after a speculative start as a multi-part question (restart on next stable text)', () => {
    const { d, questions, updates } = make();
    d.interim('what would you do if a deploy failed', 1000);
    vi.advanceTimersByTime(350);
    expect(questions).toHaveLength(1);
    d.interim('what would you do if a deploy failed at 2am and the on-call engineer', 1800);
    d.interim(
      'what would you do if a deploy failed at 2am and the on-call engineer is unreachable and customers are down',
      2600,
    );
    vi.advanceTimersByTime(350);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ restart: true, speculative: true });
    // The final matches the merged text → no further restart.
    d.final(
      'What would you do if a deploy failed at 2am and the on-call engineer is unreachable and customers are down?',
      2700,
    );
    expect(updates).toHaveLength(2);
    expect(updates[1]!.restart).toBe(false);
  });

  it('emits a plain final question when nothing was speculated', () => {
    const { d, questions } = make();
    d.interim('walk me', 100);
    d.final('Walk me through your résumé?', 700); // final arrives before the 350 ms stability window
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ speculative: false, questionEndTs: 700 });
  });

  it('emits statement for non-questions and never speculates on them', () => {
    const { d, questions, statements } = make();
    d.interim('okay great thanks for that', 100);
    vi.advanceTimersByTime(400);
    d.final('Okay great, thanks for that.', 900);
    expect(questions).toHaveLength(0);
    expect(statements).toHaveLength(1);
  });

  it('uses a fresh key per utterance', () => {
    const { d, questions } = make();
    d.interim('what is a mutex', 100);
    vi.advanceTimersByTime(350);
    d.final('What is a mutex?', 500);
    d.interim('and how is it different from a semaphore', 1000);
    vi.advanceTimersByTime(350);
    expect(questions).toHaveLength(2);
    expect(questions[0]!.key).not.toBe(questions[1]!.key);
  });
});
