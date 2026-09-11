import { EventEmitter } from 'node:events';
import type { AnswerCard, LatencySample, QuestionType, Utterance } from '@shared/types/session';
import type { AnswerEvent } from '@shared/types/ipc';
import type { Settings } from '@shared/types/settings';
import { uid, wordOverlap } from '@shared/utils';
import type { SessionDB } from '../db';
import type { SessionManager } from '../session/SessionManager';
import { emit } from '../ipc';
import { logger } from '../logger';
import { DEFAULT_PROMPTS, renderTemplate } from '../prompts';
import { buildLivePrompt, buildSystemPrefix, cacheMinimumTokens, estimateTokens, formatTranscript, profileToContext, type ContextProfile } from './ContextBuilder';
import type { LLMService } from './LLMService';
import { cleanInline, parseAnswer } from './parseAnswer';

const log = logger.scope('answers');

/** IPC update cadence for streaming cards (~30/s). */
const EMIT_INTERVAL_MS = 33;
/** Minimum gap between two *different* auto answers. */
const MIN_AUTO_GAP_MS = 2000;
/** An in-flight answer past this fraction is allowed to finish; newer requests queue. */
const KEEP_IF_PROGRESS = 0.7;
/** Rough size of a complete live answer, used to estimate progress while streaming. */
const TYPICAL_ANSWER_CHARS = 700;
const LIVE_MAX_TOKENS = 350;
const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;

export interface AnswerRequest {
  question: string;
  kind: AnswerCard['kind'];
  speculative?: boolean;
  /** Wall-clock ms of the last THEM word of the question (null for chat). */
  questionEndTs: number | null;
  /** When restarting a speculative answer, reuse its card id so the UI swaps in place. */
  restartOf?: string;
  /** Free-form follow-up (chat box) instead of the strict HEADLINE/POINTS format. */
  chat?: boolean;
}

interface Active {
  card: AnswerCard;
  controller: AbortController;
  startedAt: number;
  chars: number;
  done: boolean;
  headlineEmitted: boolean;
  lastEmit: number;
  emitTimer: NodeJS.Timeout | null;
  pendingEvent: AnswerEvent | null;
}

export interface EngineDeps {
  llm: LLMService;
  sessions: SessionManager;
  db: SessionDB;
  getSettings: () => Settings;
}

/**
 * Runs live answers: builds the prompt, streams the model output, parses HEADLINE/POINTS
 * incrementally, enforces the single-stream + queue rules and records latency.
 *
 * Events: 'card' (AnswerEvent) mirrors what is sent to the renderer.
 */
export class AnswerEngine extends EventEmitter {
  private active: Active | null = null;
  private queued: AnswerRequest | null = null;
  private cards: AnswerCard[] = [];
  private summary: string | null = null;
  private summarizedUntilMs = 0;
  private summaryTimer: NodeJS.Timeout | null = null;
  private lastAutoAt = 0;
  private lastAutoQuestion = '';
  private profileCtx: ContextProfile | null = null;
  private cacheInfo: { cached: boolean; prefixTokens: number; cacheMinimum: number } | null = null;
  restarts = 0;
  speculativeStarts = 0;

  constructor(private deps: EngineDeps) {
    super();
    deps.sessions.on('started', () => this.onSessionStart());
    deps.sessions.on('ended', () => this.onSessionEnd());
  }

  // ----- lifecycle -----
  private onSessionStart(): void {
    const s = this.deps.getSettings();
    this.cards = [];
    this.summary = null;
    this.summarizedUntilMs = 0;
    this.lastAutoAt = 0;
    this.lastAutoQuestion = '';
    this.profileCtx = profileToContext(this.deps.sessions.activeProfile, s.defaults);
    this.emitEvent({ type: 'clear' });
    void this.warm();
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    this.summaryTimer = setInterval(() => void this.updateSummary(), SUMMARY_INTERVAL_MS);
  }

  private onSessionEnd(): void {
    this.cancelActive('session ended');
    this.queued = null;
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    this.summaryTimer = null;
  }

  private template(): string {
    return this.deps.getSettings().prompts.live_answer ?? DEFAULT_PROMPTS.live_answer;
  }

  /** Warm the HTTP connection and (when the prefix is long enough) the prompt cache. */
  async warm(): Promise<void> {
    if (!this.profileCtx) return;
    const s = this.deps.getSettings();
    const prefix = buildSystemPrefix(this.template(), this.profileCtx);
    const prefixTokens = estimateTokens(prefix);
    const cacheMinimum = cacheMinimumTokens(s.models.live);
    const cached = prefixTokens >= cacheMinimum;
    this.cacheInfo = { cached, prefixTokens, cacheMinimum };
    log.info(`prefix ≈${prefixTokens} tokens, cache ${cached ? 'on' : `off (min ${cacheMinimum} for ${s.models.live})`}`);
    await this.deps.llm.warm(
      s.models.live,
      cached ? [{ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }] : [{ type: 'text', text: prefix }],
    );
  }

  cacheStatus(): { cached: boolean; prefixTokens: number; cacheMinimum: number } | null {
    return this.cacheInfo;
  }

  current(): AnswerCard[] {
    return this.cards.slice();
  }

  // ----- public API -----
  /** Manual hotkey: answer the last ~30 s of THEM speech, overriding anything in flight. */
  answerNow(): void {
    const sm = this.deps.sessions;
    if (!sm.session) {
      emit('toast', { kind: 'warning', title: 'No active session', message: 'Start listening first.' });
      return;
    }
    const nowMs = sm.nowMs();
    const recent = sm.all().filter((u) => u.speaker === 'THEM' && nowMs - u.endMs <= 30000);
    const text = recent.map((u) => u.text).join(' ').trim();
    if (!text) {
      emit('toast', { kind: 'warning', title: 'Nothing to answer yet', message: 'No speech from the other party in the last 30 seconds.' });
      return;
    }
    const last = recent[recent.length - 1];
    const questionEndTs = last ? sm.sessionStartedAt + last.endMs : Date.now();
    this.cancelActive('manual override');
    this.queued = null;
    void this.run({ question: text, kind: 'manual', questionEndTs });
  }

  /**
   * Auto-detected question. Applies the concurrency rules:
   *  - same question already in flight → ignore
   *  - in-flight answer < 70 % done → cancel it and start the new one
   *  - ≥ 70 % done → queue the new one, start when the old one finishes
   *  - different auto answers at least 2 s apart
   */
  requestAuto(req: AnswerRequest): void {
    const now = Date.now();
    if (this.active && !this.active.done) {
      const same = wordOverlap(this.active.card.question, req.question) >= 0.8;
      if (same && !req.restartOf) return;
      if (this.progress() >= KEEP_IF_PROGRESS && !req.restartOf) {
        this.queued = req;
        return;
      }
      this.cancelActive(req.restartOf ? 'restarted with fuller question' : 'newer question');
    } else if (now - this.lastAutoAt < MIN_AUTO_GAP_MS && wordOverlap(this.lastAutoQuestion, req.question) < 0.8 && !req.restartOf) {
      // Interviewer rephrasing quickly: wait, then answer the latest version.
      this.queued = req;
      setTimeout(() => this.drainQueue(), MIN_AUTO_GAP_MS - (now - this.lastAutoAt));
      return;
    }
    void this.run(req);
  }

  /** Fraction of the active answer that has streamed (0..1). */
  progress(): number {
    if (!this.active) return 1;
    if (this.active.done) return 1;
    return Math.min(1, this.active.chars / TYPICAL_ANSWER_CHARS);
  }

  activeQuestion(): { id: string; question: string; speculative: boolean } | null {
    if (!this.active || this.active.done) return null;
    return { id: this.active.card.id, question: this.active.card.question, speculative: this.active.card.latency.speculative };
  }

  cancel(id?: string, reason = 'cancelled'): void {
    if (!id || this.active?.card.id === id) this.cancelActive(reason);
    this.queued = null;
  }

  /** Fade out a speculative answer that turned out not to be a question. */
  discard(id: string): void {
    if (this.active?.card.id === id) this.cancelActive('not a question', true);
    this.cards = this.cards.filter((c) => c.id !== id);
  }

  clear(): void {
    this.cancelActive('cleared');
    this.queued = null;
    this.cards = [];
    this.emitEvent({ type: 'clear' });
  }

  setCardType(id: string, type: QuestionType, isQuestion: boolean, question: string): void {
    const card = this.cards.find((c) => c.id === id);
    if (card) {
      card.type = type;
      if (card.status === 'done') this.deps.db.saveAnswer(card);
    }
    this.emitEvent({ type: 'classified', id, isQuestion, questionType: type, question });
  }

  showChip(question: string): void {
    this.emitEvent({ type: 'chip', id: uid('chip'), question });
  }

  // ----- core -----
  private async run(req: AnswerRequest): Promise<void> {
    const sm = this.deps.sessions;
    const session = sm.session;
    if (!session || !this.profileCtx) return;
    const s = this.deps.getSettings();
    const model = s.models.live;
    const requestStartTs = Date.now();
    const card: AnswerCard = {
      id: req.restartOf ?? uid('ans'),
      sessionId: session.id,
      question: req.question,
      type: null,
      headline: '',
      points: [],
      content: '',
      model,
      status: 'streaming',
      latency: {
        questionEndTs: req.questionEndTs,
        requestStartTs,
        firstTokenTs: null,
        headlineDoneTs: null,
        doneTs: null,
        speculative: !!req.speculative,
        restarted: !!req.restartOf,
      },
      kind: req.kind,
      createdAt: requestStartTs,
    };
    if (req.speculative) this.speculativeStarts++;
    if (req.restartOf) this.restarts++;
    if (req.kind === 'auto') {
      this.lastAutoAt = requestStartTs;
      this.lastAutoQuestion = req.question;
    }
    const controller = new AbortController();
    const active: Active = {
      card,
      controller,
      startedAt: requestStartTs,
      chars: 0,
      done: false,
      headlineEmitted: false,
      lastEmit: 0,
      emitTimer: null,
      pendingEvent: null,
    };
    this.active = active;
    // Replace a restarted card in place, otherwise push newest-first.
    const idx = this.cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) this.cards[idx] = card;
    else this.cards.unshift(card);
    if (this.cards.length > 40) this.cards.pop();
    this.emitEvent({ type: 'start', card });

    const prompt = req.chat ? this.buildChatPrompt(req.question, model) : this.buildLive(req.question, model);
    try {
      const result = await this.deps.llm.stream({
        model,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: req.chat ? 500 : LIVE_MAX_TOKENS,
        temperature: 0.4,
        fast: true,
        signal: controller.signal,
        onFirstToken: (ts) => {
          card.latency.firstTokenTs = ts;
        },
        onText: (_delta, full) => {
          if (active.done) return;
          active.chars = full.length;
          card.content = full;
          if (req.chat) {
            const firstNl = full.indexOf('\n');
            card.headline = cleanInline(firstNl >= 0 ? full.slice(0, firstNl) : full);
            card.points = [];
            if (firstNl >= 0 && !active.headlineEmitted) {
              active.headlineEmitted = true;
              card.latency.headlineDoneTs = Date.now();
            }
          } else {
            const parsed = parseAnswer(full);
            card.headline = cleanInline(parsed.headline);
            card.points = [...parsed.points.map(cleanInline), ...(parsed.partialPoint ? [cleanInline(parsed.partialPoint)] : [])];
            if (parsed.headlineDone && !active.headlineEmitted && card.headline) {
              active.headlineEmitted = true;
              card.latency.headlineDoneTs = Date.now();
              this.emitEvent({ type: 'headline', id: card.id, headline: card.headline, ts: card.latency.headlineDoneTs });
            }
          }
          this.throttledDelta(active);
        },
      });
      if (active.done) return; // cancelled while finishing
      active.done = true;
      this.flushDelta(active);
      // Final parse (last point may lack a trailing newline).
      if (!req.chat) {
        const parsed = parseAnswer(result.text.endsWith('\n') ? result.text : result.text + '\n');
        card.headline = cleanInline(parsed.headline);
        card.points = parsed.points.map(cleanInline);
        if (!card.latency.headlineDoneTs && card.headline) card.latency.headlineDoneTs = Date.now();
      }
      card.status = 'done';
      card.latency.doneTs = Date.now();
      card.model = result.model;
      this.deps.db.saveAnswer(card);
      this.recordLatency(card);
      const ftl = card.latency.firstTokenTs && card.latency.questionEndTs ? card.latency.firstTokenTs - card.latency.questionEndTs : null;
      log.info(
        `answer ${card.id} done in ${card.latency.doneTs - requestStartTs} ms` +
          (ftl !== null ? `, first token ${ftl} ms after question end` : '') +
          ` (in ${result.usage.input}, cached ${result.usage.cacheRead}, out ${result.usage.output})`,
      );
      this.emitEvent({ type: 'done', id: card.id, card });
    } catch (err) {
      if (active.done) return;
      active.done = true;
      this.flushDelta(active);
      if (controller.signal.aborted) {
        card.status = 'cancelled';
        if (card.headline || card.content) this.deps.db.saveAnswer(card);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      card.status = 'error';
      card.error = message;
      log.warn('answer failed', message);
      this.emitEvent({ type: 'error', id: card.id, error: message });
      if (/api key|authentication|401/i.test(message)) {
        emit('toast', { kind: 'error', title: 'Anthropic API key problem', message, sticky: true });
      }
    } finally {
      if (this.active === active) this.active = null;
      this.drainQueue();
    }
  }

  private cancelActive(reason: string, fade = false): void {
    const a = this.active;
    if (!a || a.done) return;
    a.done = true;
    a.controller.abort();
    if (a.emitTimer) clearTimeout(a.emitTimer);
    a.card.status = 'cancelled';
    this.emitEvent({ type: 'cancelled', id: a.card.id, reason: fade ? 'not-a-question' : reason });
    if (fade || !(a.card.headline || a.card.content)) this.cards = this.cards.filter((c) => c.id !== a.card.id);
    this.active = null;
    log.debug('cancelled answer', a.card.id, reason);
  }

  private drainQueue(): void {
    if (this.active && !this.active.done) return;
    const q = this.queued;
    if (!q) return;
    this.queued = null;
    void this.run(q);
  }

  private throttledDelta(a: Active): void {
    const ev: AnswerEvent = {
      type: 'delta',
      id: a.card.id,
      text: '',
      headline: a.card.headline,
      points: a.card.points,
      content: a.card.content,
    };
    const now = Date.now();
    if (now - a.lastEmit >= EMIT_INTERVAL_MS) {
      a.lastEmit = now;
      a.pendingEvent = null;
      this.emitEvent(ev);
    } else {
      a.pendingEvent = ev;
      if (!a.emitTimer) {
        a.emitTimer = setTimeout(() => {
          a.emitTimer = null;
          if (a.pendingEvent) {
            a.lastEmit = Date.now();
            const p = a.pendingEvent;
            a.pendingEvent = null;
            this.emitEvent(p);
          }
        }, EMIT_INTERVAL_MS - (now - a.lastEmit));
      }
    }
  }

  private flushDelta(a: Active): void {
    if (a.emitTimer) clearTimeout(a.emitTimer);
    a.emitTimer = null;
    a.pendingEvent = null;
    this.emitEvent({ type: 'delta', id: a.card.id, text: '', headline: a.card.headline, points: a.card.points, content: a.card.content });
  }

  private emitEvent(ev: AnswerEvent): void {
    emit('answer:event', ev);
    this.emit('card', ev);
  }

  private recordLatency(card: AnswerCard): void {
    const sample: LatencySample = {
      answerId: card.id,
      questionEndTs: card.latency.questionEndTs,
      requestStartTs: card.latency.requestStartTs,
      firstTokenTs: card.latency.firstTokenTs,
      headlineDoneTs: card.latency.headlineDoneTs,
      speculative: card.latency.speculative,
      restarted: card.latency.restarted,
      createdAt: Date.now(),
    };
    this.deps.db.saveLatency(sample);
    emit('latency:sample', sample);
  }

  // ----- prompts -----
  private buildLive(question: string, model: string) {
    const sm = this.deps.sessions;
    return buildLivePrompt({
      template: this.template(),
      profile: this.profileCtx!,
      model,
      utterances: sm.finals(),
      nowMs: sm.nowMs(),
      summary: this.summary,
      question,
    });
  }

  private buildChatPrompt(text: string, model: string) {
    const sm = this.deps.sessions;
    const base = buildLivePrompt({ template: this.template(), profile: this.profileCtx!, model, utterances: sm.finals(), nowMs: sm.nowMs(), summary: this.summary, question: text });
    const previous = this.cards
      .filter((c) => c.status === 'done' && c.kind !== 'chat')
      .slice(0, 3)
      .map((c) => `Q: ${c.question}\nSuggested: ${c.headline}${c.points.length ? '\n- ' + c.points.join('\n- ') : ''}`)
      .join('\n\n');
    const user =
      base.user.replace(/Question: [\s\S]*$/, '') +
      (previous ? `<previous_suggestions>\n${previous}\n</previous_suggestions>\n\n` : '') +
      `Follow-up request from the user (not from the other party): ${text}\n\n` +
      'Reply in plain text, at most 80 words, first line = the most useful sentence. Ignore the HEADLINE/POINTS format for this reply.';
    return { system: base.system, user };
  }

  /** Every 5 minutes, fold transcript older than the window into a ≤150-word summary. */
  private async updateSummary(): Promise<void> {
    const sm = this.deps.sessions;
    if (!sm.session) return;
    const nowMs = sm.nowMs();
    const cutoff = nowMs - 5 * 60 * 1000;
    const older: Utterance[] = sm.finals().filter((u) => u.endMs <= cutoff && u.endMs > this.summarizedUntilMs);
    if (older.length < 4) return;
    const s = this.deps.getSettings();
    const text = (this.summary ? `Previous summary:\n${this.summary}\n\nNew transcript:\n` : '') + formatTranscript(older, nowMs, Number.MAX_SAFE_INTEGER, 12000);
    try {
      let out = '';
      await this.deps.llm.stream({
        model: s.models.classifier,
        system: renderTemplate(s.prompts.summary ?? DEFAULT_PROMPTS.summary, {}),
        messages: [{ role: 'user', content: text }],
        maxTokens: 300,
        fast: true,
        onText: (_d, full) => (out = full),
      });
      this.summary = out.trim();
      this.summarizedUntilMs = older[older.length - 1]?.endMs ?? this.summarizedUntilMs;
      log.debug('summary updated', this.summary.length, 'chars');
    } catch (err) {
      log.warn('summary failed', err);
    }
  }
}
