import { describe, expect, it } from 'vitest';
import { parseAnswer } from '@main/llm/parseAnswer';

describe('parseAnswer', () => {
  it('parses the strict format incrementally', () => {
    const p1 = parseAnswer('HEADLINE: I led the migration of our billing');
    expect(p1.headline).toBe('I led the migration of our billing');
    expect(p1.headlineDone).toBe(false);
    const p2 = parseAnswer(
      'HEADLINE: I led the migration of our billing system.\nPOINTS:\n- Situation: legacy system\n- Task: cut inv',
    );
    expect(p2.headlineDone).toBe(true);
    expect(p2.points).toEqual(['Situation: legacy system']);
    expect(p2.partialPoint).toBe('Task: cut inv');
    const p3 = parseAnswer(p2 && 'HEADLINE: x\nPOINTS:\n- a\n- b\n- c\n');
    expect(p3.points).toEqual(['a', 'b', 'c']);
    expect(p3.partialPoint).toBe('');
  });

  it('tolerates markdown decoration and numbered bullets', () => {
    const p = parseAnswer(
      '**HEADLINE:** Yes — I have shipped three production ML systems.\n**POINTS:**\n1. First\n2) Second\n* Third\n',
    );
    expect(p.headline).toBe('Yes — I have shipped three production ML systems.');
    expect(p.points).toEqual(['First', 'Second', 'Third']);
  });

  it('falls back when the model ignores the format', () => {
    const p = parseAnswer('I would start by clarifying the requirements.\nThen sketch the API.\n');
    expect(p.headline).toBe('I would start by clarifying the requirements.');
    expect(p.points).toEqual(['Then sketch the API.']);
  });

  it('handles a wrapped headline', () => {
    const p = parseAnswer(
      'HEADLINE: My biggest strength is\nturning vague asks into shipped features.\nPOINTS:\n- x\n',
    );
    expect(p.headline).toBe('My biggest strength is turning vague asks into shipped features.');
    expect(p.headlineDone).toBe(true);
  });
});
