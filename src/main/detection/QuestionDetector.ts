import { EventEmitter } from 'node:events';
import { normalizeWords, wordOverlap } from '@shared/utils';

/** §5.3 fast heuristic — runs on every interim result, must stay well under 1 ms. */
const TRIGGERS = [
  'what',
  'why',
  'how',
  'when',
  'where',
  'which',
  'who',
  'can you',
  'could you',
  'would you',
  'do you',
  'did you',
  'have you',
  'tell me',
  'walk me through',
  'describe',
  'explain',
  'give me an example',
  'talk about',
  'share',
  'what if',
  'how would you',
  'why should we',
  'take me through',
  "let's talk about",
  'lets talk about',
  'talk me through',
  'tell us',
  'are you',
  'is there',
  'any questions',
];
const TRIGGER_RE = new RegExp(`(^|[^\\p{L}])(${TRIGGERS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?")).join('|')})(?=$|[^\\p{L}])`, 'iu');

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?\s*["')\]]*$/.test(t)) return true;
  if (normalizeWords(t).length < 2) return false;
  return TRIGGER_RE.test(t);
}

export interface DetectedQuestion {
  /** Stable id for this utterance's question (same across speculative → final). */
  key: string;
  text: string;
  speculative: boolean;
  /** Wall-clock ms of the last word heard. */
  questionEndTs: number;
}

export interface QuestionUpdate extends DetectedQuestion {
  /** Word overlap with the previously emitted text for this key. */
  overlap: number;
  /** True when the text changed enough that a running answer must restart. */
  restart: boolean;
}

export interface DetectorOptions {
  /** Interim text must be unchanged for this long before a speculative start. */
  stableMs?: number;
  /** Overlap at/above which the final is considered "the same question". */
  sameThreshold?: number;
}

/**
 * Turns the THEM interim/final stream into question events (§5.2):
 *  - 'question' once per utterance: speculative (stable interim) or final
 *  - 'update' when a later stable text / the final differs (restart=true) or matches
 *  - 'statement' when an utterance finalises without looking like a question
 */
export class QuestionDetector extends EventEmitter {
  private stableMs: number;
  private sameThreshold: number;
  private timer: NodeJS.Timeout | null = null;
  private pendingText = '';
  private pendingEndTs = 0;
  private utteranceKey: string | null = null;
  private emittedText: string | null = null;
  private seq = 0;

  constructor(opts: DetectorOptions = {}) {
    super();
    this.stableMs = opts.stableMs ?? 350;
    this.sameThreshold = opts.sameThreshold ?? 0.8;
  }

  /** Feed the running text of the current THEM utterance (finals-so-far + interim). */
  interim(text: string, lastWordWallMs: number): void {
    const t = text.trim();
    if (!t) return;
    if (!this.utteranceKey) this.utteranceKey = `q${++this.seq}`;
    if (t === this.pendingText) return; // no new words: keep the stability timer running
    this.pendingText = t;
    this.pendingEndTs = lastWordWallMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.consider(this.pendingText, this.pendingEndTs, true);
    }, this.stableMs);
  }

  /** The utterance finalised with this text. */
  final(text: string, lastWordWallMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const t = text.trim();
    const key = this.utteranceKey ?? `q${++this.seq}`;
    if (t) this.consider(t, lastWordWallMs, false);
    else if (this.emittedText) this.emit('statement', { key });
    this.utteranceKey = null;
    this.emittedText = null;
    this.pendingText = '';
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.utteranceKey = null;
    this.emittedText = null;
    this.pendingText = '';
  }

  private consider(text: string, endTs: number, speculative: boolean): void {
    const key = this.utteranceKey ?? `q${++this.seq}`;
    this.utteranceKey = key;
    const isQ = looksLikeQuestion(text);
    if (this.emittedText === null) {
      if (!isQ) {
        if (!speculative) this.emit('statement', { key, text });
        return;
      }
      this.emittedText = text;
      this.emit('question', { key, text, speculative, questionEndTs: endTs } satisfies DetectedQuestion);
      return;
    }
    if (text === this.emittedText) {
      if (!speculative) this.emit('update', { key, text, speculative: false, questionEndTs: endTs, overlap: 1, restart: false } satisfies QuestionUpdate);
      return;
    }
    const overlap = wordOverlap(this.emittedText, text);
    const restart = overlap < this.sameThreshold;
    if (restart) this.emittedText = text;
    this.emit('update', { key, text, speculative, questionEndTs: endTs, overlap, restart } satisfies QuestionUpdate);
  }
}
