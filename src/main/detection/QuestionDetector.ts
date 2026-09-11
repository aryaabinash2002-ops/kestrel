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
const TRIGGER_RE = new RegExp(
  `(^|[^\\p{L}])(${TRIGGERS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?")).join('|')})(?=$|[^\\p{L}])`,
  'iu',
);

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
  /** Interim text must be unchanged for this long before a speculative start (complete-looking text). */
  stableMs?: number;
  /** Stability required when the interim ends mid-clause (article, preposition, auxiliary…). */
  stableMsIncomplete?: number;
  /** Overlap at/above which the final is considered "the same question". */
  sameThreshold?: number;
  /** A new utterance starting within this window continues the previous question (§5.2.4). */
  mergeWindowMs?: number;
  /** Returns true while the other party is still audibly speaking (speculation is deferred). */
  stillSpeaking?: () => boolean;
}

/** Words a question rarely ends on: the speaker is almost certainly mid-clause. */
const INCOMPLETE_ENDINGS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'your',
  'my',
  'our',
  'their',
  'his',
  'her',
  'its',
  'and',
  'or',
  'but',
  'that',
  'this',
  'these',
  'those',
  'what',
  'how',
  'when',
  'where',
  'which',
  'who',
  'why',
  'you',
  'can',
  'could',
  'would',
  'should',
  'do',
  'did',
  'does',
  'have',
  'has',
  'had',
  'me',
  'us',
  'about',
  'through',
  'into',
  'if',
  'as',
  'so',
  'very',
  'most',
  'some',
  'any',
  'more',
  'like',
  'um',
  'uh',
  'kind',
  'sort',
  'tell',
  'describe',
  'explain',
  'give',
  'walk',
  'take',
  'share',
]);

/** True when `next` contains a content word (≥ 4 letters, not a function word) absent from `prev`. */
export function addsContentWord(prev: string, next: string): boolean {
  const had = new Set(normalizeWords(prev));
  return normalizeWords(next).some(
    (w) => w.length >= 4 && !INCOMPLETE_ENDINGS.has(w) && !FILLER.has(w) && !had.has(w),
  );
}

const FILLER = new Set([
  'please',
  'thanks',
  'thank',
  'okay',
  'right',
  'yeah',
  'just',
  'maybe',
  'really',
  'actually',
  'basically',
  'little',
  'bit',
]);

/** True when the text ends on a word that usually has more to come. */
export function endsMidClause(text: string): boolean {
  const words = normalizeWords(text);
  const last = words[words.length - 1];
  return !!last && INCOMPLETE_ENDINGS.has(last) && !/\?\s*$/.test(text);
}

/**
 * Turns the THEM interim/final stream into question events (§5.2):
 *  - 'question' once per utterance: speculative (stable interim) or final
 *  - 'update' when a later stable text / the final differs (restart=true) or matches
 *  - 'statement' when an utterance finalises without looking like a question
 */
export class QuestionDetector extends EventEmitter {
  private stableMs: number;
  private stableMsIncomplete: number;
  private sameThreshold: number;
  private stillSpeaking: () => boolean;
  private mergeWindowMs: number;
  private deferrals = 0;
  private timer: NodeJS.Timeout | null = null;
  private pendingText = '';
  private pendingEndTs = 0;
  private utteranceKey: string | null = null;
  private emittedText: string | null = null;
  private seq = 0;
  /** Text of the previous finalised utterance, so a short pause does not split one question in two. */
  private lastFinal: { key: string; text: string; at: number; emitted: string | null } | null =
    null;
  private prefix = '';

  constructor(opts: DetectorOptions = {}) {
    super();
    this.stableMs = opts.stableMs ?? 200;
    this.stableMsIncomplete = opts.stableMsIncomplete ?? 600;
    this.sameThreshold = opts.sameThreshold ?? 0.8;
    this.stillSpeaking = opts.stillSpeaking ?? (() => false);
    this.mergeWindowMs = opts.mergeWindowMs ?? 1500;
  }

  /** Feed the running text of the current THEM utterance (finals-so-far + interim). */
  interim(text: string, lastWordWallMs: number): void {
    const raw = text.trim();
    if (!raw) return;
    if (!this.utteranceKey) this.startUtterance();
    const t = (this.prefix + raw).trim();
    if (t === this.pendingText) return; // no new words: keep the stability timer running
    this.pendingText = t;
    this.pendingEndTs = lastWordWallMs;
    if (this.timer) clearTimeout(this.timer);
    // A pause after "…walk me through a" is not the end of the question; wait longer there.
    const wait = endsMidClause(t) ? this.stableMsIncomplete : this.stableMs;
    this.deferrals = 0;
    this.armStableTimer(wait);
  }

  /** Fire once the text is stable AND the speaker has gone quiet (interim gaps ≠ silence). */
  private armStableTimer(wait: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stillSpeaking() && this.deferrals < 8) {
        this.deferrals++;
        this.armStableTimer(120);
        return;
      }
      this.consider(this.pendingText, this.pendingEndTs, true);
    }, wait);
  }

  /** The utterance finalised with this text. */
  final(text: string, lastWordWallMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.utteranceKey) this.startUtterance();
    const t = (this.prefix + text.trim()).trim();
    const key = this.utteranceKey ?? `q${++this.seq}`;
    if (t) this.consider(t, lastWordWallMs, false);
    else if (this.emittedText) this.emit('statement', { key });
    this.lastFinal = t ? { key, text: t, at: Date.now(), emitted: this.emittedText } : null;
    this.utteranceKey = null;
    this.emittedText = null;
    this.pendingText = '';
    this.prefix = '';
  }

  /**
   * Begin a new utterance. If the previous one finalised less than `mergeWindowMs` ago it is
   * treated as the same question ("Tell me about a time you failed" … "and what did you learn?"):
   * the texts are merged and a running answer for it is restarted rather than duplicated.
   */
  private startUtterance(): void {
    const lf = this.lastFinal;
    if (lf && Date.now() - lf.at < this.mergeWindowMs) {
      this.utteranceKey = lf.key;
      this.prefix = lf.text + ' ';
      this.emittedText = lf.emitted;
    } else {
      this.utteranceKey = `q${++this.seq}`;
      this.prefix = '';
    }
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.utteranceKey = null;
    this.emittedText = null;
    this.pendingText = '';
    this.prefix = '';
    this.lastFinal = null;
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
      this.emit('question', {
        key,
        text,
        speculative,
        questionEndTs: endTs,
      } satisfies DetectedQuestion);
      return;
    }
    if (text === this.emittedText) {
      if (!speculative)
        this.emit('update', {
          key,
          text,
          speculative: false,
          questionEndTs: endTs,
          overlap: 1,
          restart: false,
        } satisfies QuestionUpdate);
      return;
    }
    const overlap = wordOverlap(this.emittedText, text);
    // ≥ 80 % overlap keeps the running answer — unless the new text adds a content word the
    // answer never saw ("…your biggest" → "…your biggest weakness?"), which changes the question.
    const restart = overlap < this.sameThreshold || addsContentWord(this.emittedText, text);
    if (restart) this.emittedText = text;
    this.emit('update', {
      key,
      text,
      speculative,
      questionEndTs: endTs,
      overlap,
      restart,
    } satisfies QuestionUpdate);
  }
}
