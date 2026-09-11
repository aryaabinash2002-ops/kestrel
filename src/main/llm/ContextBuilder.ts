import type Anthropic from '@anthropic-ai/sdk';
import type { Profile, Utterance } from '@shared/types/session';
import type { AnswerLength, InterviewType, Tone } from '@shared/types/settings';
import { renderTemplate } from '../prompts';

/** Minimum cacheable prefix per model family (tokens). Shorter prefixes silently do not cache. */
export function cacheMinimumTokens(model: string): number {
  if (/haiku-4-5|opus-4-6|opus-4-5/.test(model)) return 4096;
  if (/opus-4-7|haiku-3-5/.test(model)) return 2048;
  if (/opus-5|fable/.test(model)) return 512;
  return 1024; // sonnet-5, sonnet-4-6, opus-4-8, …
}

/** Rough token estimate (≈ 3.6 chars/token for English prose + résumé formatting). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export interface ContextProfile {
  userName: string;
  role: string;
  company: string;
  type: InterviewType;
  language: string;
  length: AnswerLength;
  tone: Tone;
  resumeText: string;
  jdText: string;
  stories: string;
  notes: string;
}

export interface BuiltPrompt {
  system: Anthropic.TextBlockParam[];
  user: string;
  /** Whether cache_control was attached to the static prefix. */
  cached: boolean;
  prefixTokens: number;
  cacheMinimum: number;
}

export const TRANSCRIPT_WINDOW_MS = 5 * 60 * 1000;
export const TRANSCRIPT_MAX_CHARS = 7000;

export function profileToContext(
  p: Profile | null,
  defaults: { length: AnswerLength; tone: Tone; language: string },
): ContextProfile {
  return {
    userName: p?.userName || 'the user',
    role: p?.role || 'the role being discussed',
    company: p?.company || 'the company',
    type: p?.type ?? 'general',
    language: p?.language || defaults.language,
    length: p?.length ?? defaults.length,
    tone: p?.tone ?? defaults.tone,
    resumeText:
      p?.resumeText ||
      '(no résumé uploaded — do not invent experience; suggest transferable examples instead)',
    jdText: p?.jdText || '(no job description provided)',
    stories: p?.stories?.length
      ? p.stories.map((s) => `### ${s.title}\n${s.text}`).join('\n\n')
      : '(none)',
    notes: p?.notes || '(none)',
  };
}

const LENGTH_WORDS: Record<AnswerLength, string> = {
  short: 'short (headline + 3 points, each under 12 words)',
  medium: 'medium (headline + 4 points)',
  detailed: 'detailed (headline + 5 points, each may include one concrete number or name)',
};

/** Render the static system prefix for the live answer prompt. */
export function buildSystemPrefix(template: string, ctx: ContextProfile): string {
  return renderTemplate(template, {
    user_name: ctx.userName,
    interview_type: ctx.type.replace('_', ' '),
    role: ctx.role,
    company: ctx.company,
    language: ctx.language,
    length: LENGTH_WORDS[ctx.length],
    tone: ctx.tone,
    resume_text: ctx.resumeText,
    jd_text: ctx.jdText,
    stories: ctx.stories,
    notes: ctx.notes,
    behavioral: ctx.type === 'behavioral' || ctx.type === 'general',
    technical: ctx.type === 'technical' || ctx.type === 'system_design',
    sales: ctx.type === 'sales',
  });
}

/**
 * Trim the transcript to the last `windowMs` (by end time) and at most `maxChars`,
 * newest kept. Returns ME/THEM labelled lines.
 */
export function formatTranscript(
  utterances: Utterance[],
  nowMs: number,
  windowMs = TRANSCRIPT_WINDOW_MS,
  maxChars = TRANSCRIPT_MAX_CHARS,
): string {
  const recent = utterances.filter(
    (u) => u.isFinal && u.speaker !== 'AI' && nowMs - u.endMs <= windowMs,
  );
  const lines: string[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const u = recent[i]!;
    const line = `${u.speaker}${u.speakerName ? ` (${u.speakerName})` : ''}: ${u.text}`;
    if (chars + line.length > maxChars) break;
    lines.unshift(line);
    chars += line.length + 1;
  }
  return lines.join('\n');
}

export interface BuildArgs {
  template: string;
  profile: ContextProfile;
  model: string;
  utterances: Utterance[];
  nowMs: number;
  summary: string | null;
  question: string;
  /** Force cache_control on/off (tests). */
  cache?: boolean;
}

/** Build the (static, cacheable) system blocks and the per-request user message. */
export function buildLivePrompt(a: BuildArgs): BuiltPrompt {
  const prefix = buildSystemPrefix(a.template, a.profile);
  const prefixTokens = estimateTokens(prefix);
  const cacheMinimum = cacheMinimumTokens(a.model);
  const cached = a.cache ?? prefixTokens >= cacheMinimum;
  const system: Anthropic.TextBlockParam[] = [
    cached
      ? { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: prefix },
  ];
  const transcript = formatTranscript(a.utterances, a.nowMs);
  const parts: string[] = [];
  if (a.summary) parts.push(`<earlier_summary>\n${a.summary}\n</earlier_summary>`);
  parts.push(`<transcript_recent>\n${transcript || '(nothing yet)'}\n</transcript_recent>`);
  parts.push(`Question: ${a.question.trim()}`);
  return { system, user: parts.join('\n\n'), cached, prefixTokens, cacheMinimum };
}
