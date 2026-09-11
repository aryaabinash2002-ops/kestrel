import { describe, expect, it } from 'vitest';
import {
  buildLivePrompt,
  cacheMinimumTokens,
  formatTranscript,
  profileToContext,
} from '@main/llm/ContextBuilder';
import { DEFAULT_PROMPTS, renderTemplate } from '@main/prompts';
import type { Profile, Utterance } from '@shared/types/session';

const profile: Profile = {
  id: 'p1',
  name: 'Acme SWE',
  role: 'Senior Software Engineer',
  company: 'Acme',
  type: 'behavioral',
  language: 'English',
  length: 'short',
  tone: 'confident',
  resumeText: 'Jane Doe. Senior engineer at Globex 2020-2024. Led billing migration saving $1.2M.',
  jdText: 'We need a senior engineer to own payments.',
  stories: [
    {
      id: 's1',
      title: 'Billing migration',
      text: 'Migrated billing to Stripe in 4 months with zero downtime.',
    },
  ],
  notes: 'Mention the Stripe migration.',
  knowledgeText:
    'Loop bundles: a Preset fixed bundle has fixed contents; Build-your-own lets customers pick items.',
  userName: 'Jane',
  createdAt: 0,
  updatedAt: 0,
};

function utt(speaker: 'ME' | 'THEM', text: string, endMs: number): Utterance {
  return {
    id: `u${endMs}`,
    sessionId: 's',
    speaker,
    text,
    startMs: endMs - 1000,
    endMs,
    isFinal: true,
    source: 'stt',
  };
}

describe('prompt rendering', () => {
  it('fills variables and conditional blocks', () => {
    const out = renderTemplate('Hi {name}. {if flag}ON{/if}{if other}OFF{/if} {missing}!', {
      name: 'Jane',
      flag: true,
      other: false,
    });
    expect(out).toBe('Hi Jane. ON !');
  });

  it('renders the live-answer system prompt with résumé, JD, stories and STAR rule for behavioral', () => {
    const ctx = profileToContext(profile, {
      length: 'short',
      tone: 'confident',
      language: 'English',
    });
    const built = buildLivePrompt({
      template: DEFAULT_PROMPTS.live_answer,
      profile: ctx,
      model: 'claude-sonnet-5',
      utterances: [],
      nowMs: 0,
      summary: null,
      question: 'Tell me about a challenge',
    });
    const sys = built.system[0]!.text;
    expect(sys).toContain('answers to Jane during a live behavioral conversation');
    expect(sys).toContain('Senior Software Engineer at Acme');
    expect(sys).toContain('tell it as a short story');
    expect(sys).not.toContain('Technical: give the core idea');
    expect(sys).toContain('Puzzles / brain teasers');
    expect(sys).toContain('Led billing migration saving $1.2M');
    expect(sys).toContain('### Billing migration');
    expect(sys).toContain('Mention the Stripe migration.');
    expect(sys).toContain('Preset fixed bundle has fixed contents');
    expect(sys).toContain('sound like a real person');
    expect(sys).not.toMatch(/\{[a-z_]+\}/); // no unfilled placeholders
    expect(built.user).toContain('Question: Tell me about a challenge');
  });
});

describe('ContextBuilder trimming + caching', () => {
  it('keeps only the last 5 minutes of transcript, newest-first budget', () => {
    const nowMs = 20 * 60 * 1000;
    const utts = [
      utt('THEM', 'old question', nowMs - 6 * 60 * 1000),
      utt('ME', 'recent answer', nowMs - 60 * 1000),
      utt('THEM', 'newest', nowMs - 1000),
    ];
    const t = formatTranscript(utts, nowMs);
    expect(t).not.toContain('old question');
    expect(t).toBe('ME: recent answer\nTHEM: newest');
  });

  it('caps the transcript by characters keeping the newest lines', () => {
    const nowMs = 100000;
    const utts = Array.from({ length: 200 }, (_, i) =>
      utt('THEM', `line ${i} ` + 'x'.repeat(80), 1000 + i * 100),
    );
    const t = formatTranscript(utts, nowMs, 60 * 60 * 1000, 2000);
    expect(t.length).toBeLessThanOrEqual(2000);
    expect(t).toContain('line 199');
    expect(t).not.toContain('line 0 ');
  });

  it('only marks cache_control when the prefix reaches the model minimum', () => {
    const ctx = profileToContext(profile, {
      length: 'short',
      tone: 'confident',
      language: 'English',
    });
    const small = buildLivePrompt({
      template: DEFAULT_PROMPTS.live_answer,
      profile: ctx,
      model: 'claude-haiku-4-5-20251001',
      utterances: [],
      nowMs: 0,
      summary: null,
      question: 'q',
    });
    expect(cacheMinimumTokens('claude-haiku-4-5-20251001')).toBe(4096);
    expect(small.cached).toBe(false);
    expect(small.system[0]).not.toHaveProperty('cache_control');
    const bigCtx = { ...ctx, resumeText: 'word '.repeat(6000) };
    const big = buildLivePrompt({
      template: DEFAULT_PROMPTS.live_answer,
      profile: bigCtx,
      model: 'claude-haiku-4-5-20251001',
      utterances: [],
      nowMs: 0,
      summary: null,
      question: 'q',
    });
    expect(big.cached).toBe(true);
    expect(big.system[0]).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(cacheMinimumTokens('claude-sonnet-5')).toBe(1024);
    expect(cacheMinimumTokens('claude-opus-5')).toBe(512);
  });

  it('includes the running summary before the recent transcript', () => {
    const ctx = profileToContext(null, { length: 'short', tone: 'casual', language: 'English' });
    const built = buildLivePrompt({
      template: DEFAULT_PROMPTS.live_answer,
      profile: ctx,
      model: 'claude-sonnet-5',
      utterances: [utt('THEM', 'hi', 500)],
      nowMs: 1000,
      summary: 'Earlier they discussed salary.',
      question: 'q',
    });
    expect(built.user.indexOf('<earlier_summary>')).toBeLessThan(
      built.user.indexOf('<transcript_recent>'),
    );
    expect(built.system[0]!.text).toContain('no résumé uploaded');
  });
});
