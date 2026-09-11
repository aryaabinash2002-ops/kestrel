import type { Settings } from '@shared/types/settings';
import type { QuestionType } from '@shared/types/session';
import { wordOverlap } from '@shared/utils';
import { QuestionDetector, type DetectedQuestion, type QuestionUpdate } from '../detection/QuestionDetector';
import type { FinalEvent, InterimEvent, TranscriptionService } from '../transcription/TranscriptionService';
import type { SessionManager } from '../session/SessionManager';
import type { AnswerEngine } from './AnswerEngine';
import type { Classifier } from './Classifier';
import { emit } from '../ipc';
import { logger } from '../logger';

const log = logger.scope('auto');

/**
 * The instant-answer pipeline (§5): THEM interim → QuestionDetector → speculative answer,
 * with the JSON classifier running in parallel to veto non-questions / smalltalk and to
 * label the card. Nothing here waits for a final transcript.
 */
export class AutoAnswer {
  readonly detector = new QuestionDetector();
  private classifyController: AbortController | null = null;
  /** card id per detector key, so finals/restarts address the right card */
  private cardByKey = new Map<string, string>();
  private lastClassified = new Map<string, { type: QuestionType; isQuestion: boolean; text: string }>();

  constructor(
    transcription: TranscriptionService,
    private sessions: SessionManager,
    private engine: AnswerEngine,
    private classifier: Classifier,
    private getSettings: () => Settings,
  ) {
    transcription.on('interim', (e: InterimEvent) => {
      if (e.channel === 'THEM') this.detector.interim(e.text, e.lastWordWallMs);
    });
    transcription.on('final', (e: FinalEvent) => {
      if (e.channel === 'THEM') this.detector.final(e.utterance.text, e.lastWordWallMs);
    });
    sessions.on('started', () => this.reset());
    sessions.on('ended', () => this.reset());
    this.detector.on('question', (q: DetectedQuestion) => this.onQuestion(q));
    this.detector.on('update', (u: QuestionUpdate) => this.onUpdate(u));
  }

  private reset(): void {
    this.detector.reset();
    this.cardByKey.clear();
    this.lastClassified.clear();
    this.classifyController?.abort();
    this.classifyController = null;
  }

  private enabled(): boolean {
    return this.getSettings().autoAnswer && !!this.sessions.session;
  }

  private onQuestion(q: DetectedQuestion): void {
    if (!this.enabled()) return;
    emit('question:detected', { text: q.text, speculative: q.speculative, ts: q.questionEndTs });
    this.engine.requestAuto({ question: q.text, kind: 'auto', speculative: q.speculative, questionEndTs: q.questionEndTs });
    const active = this.engine.activeQuestion();
    if (active && wordOverlap(active.question, q.text) >= 0.8) this.cardByKey.set(q.key, active.id);
    void this.classify(q.key, q.text);
    log.debug(`question (${q.speculative ? 'speculative' : 'final'}):`, q.text);
  }

  private onUpdate(u: QuestionUpdate): void {
    if (!this.enabled()) return;
    const cardId = this.cardByKey.get(u.key);
    if (!u.restart) {
      // Same question confirmed by the final: keep the running answer, fix the end timestamp.
      if (cardId && !u.speculative) this.engine.updateQuestionEnd(cardId, u.questionEndTs);
      return;
    }
    log.debug(`restart (overlap ${u.overlap.toFixed(2)}):`, u.text);
    emit('question:detected', { text: u.text, speculative: u.speculative, ts: u.questionEndTs });
    const active = this.engine.activeQuestion();
    const restartOf = cardId && active?.id === cardId ? cardId : undefined;
    this.engine.requestAuto({ question: u.text, kind: 'auto', speculative: u.speculative, questionEndTs: u.questionEndTs, restartOf });
    const now = this.engine.activeQuestion();
    if (now) this.cardByKey.set(u.key, now.id);
    void this.classify(u.key, u.text);
  }

  private async classify(key: string, text: string): Promise<void> {
    const prev = this.lastClassified.get(key);
    if (prev && wordOverlap(prev.text, text) >= 0.8) return;
    this.classifyController?.abort();
    const controller = new AbortController();
    this.classifyController = controller;
    const context = this.sessions
      .finals()
      .filter((u) => u.speaker === 'THEM')
      .slice(-3, -1)
      .map((u) => `THEM: ${u.text}`);
    try {
      const c = await this.classifier.classify(text, context, controller.signal);
      if (controller.signal.aborted) return;
      this.lastClassified.set(key, { type: c.type, isQuestion: c.is_question, text });
      const cardId = this.cardByKey.get(key) ?? this.engine.activeQuestion()?.id;
      const s = this.getSettings();
      if (!c.is_question) {
        if (cardId) this.engine.discard(cardId);
        log.debug('classifier: not a question →', text);
        return;
      }
      if (c.type === 'smalltalk' && !s.smalltalkAnswers) {
        if (cardId) this.engine.discard(cardId);
        this.engine.showChip(c.question);
        return;
      }
      if (cardId) this.engine.setCardType(cardId, c.type, true, c.question);
    } catch (err) {
      if (!controller.signal.aborted) log.debug('classifier failed', err);
    }
  }
}
