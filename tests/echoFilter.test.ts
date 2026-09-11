import { describe, expect, it } from 'vitest';
import { EchoFilter } from '@main/transcription/EchoFilter';
import { textSimilarity, wordOverlap } from '@shared/utils';

describe('EchoFilter', () => {
  it('drops ME text that duplicates recent THEM speech', () => {
    const f = new EchoFilter(3000, 0.7);
    const t = 1_000_000;
    f.noteThem('So tell me about a time you had a conflict with a coworker', t);
    expect(f.isEcho('tell me about a time you had a conflict with a coworker', t + 400)).toBe(true);
    expect(f.isEcho('Tell me about a time you had a conflict with a co-worker.', t + 900)).toBe(
      true,
    );
  });

  it('keeps genuinely different ME speech', () => {
    const f = new EchoFilter(3000, 0.7);
    const t = 1_000_000;
    f.noteThem('Tell me about a time you had a conflict with a coworker', t);
    expect(
      f.isEcho('Sure. Last year at Acme I disagreed with our lead about the rollout plan', t + 500),
    ).toBe(false);
    expect(f.isEcho('yes', t + 500)).toBe(false);
  });

  it('forgets THEM text after the window', () => {
    const f = new EchoFilter(3000, 0.7);
    const t = 1_000_000;
    f.noteThem('What is your greatest weakness', t);
    expect(f.isEcho('what is your greatest weakness', t + 3500)).toBe(false);
  });

  it('similarity helpers behave', () => {
    expect(wordOverlap('a b c d', 'a b c d')).toBe(1);
    expect(wordOverlap('a b c d', 'x y z')).toBe(0);
    expect(
      textSimilarity('walk me through your resume', 'Can you walk me through your resume please?'),
    ).toBeGreaterThan(0.7);
  });
});
