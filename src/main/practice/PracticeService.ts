import { EventEmitter } from 'node:events';
import type { PracticeEvent, PracticeHistoryEntry, PracticeQuestionSet, SessionState } from '@shared/types/ipc';
import type { PracticeScore, Profile } from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import { uid } from '@shared/utils';
import type { SessionDB } from '../db';
import type { AudioManager } from '../audio/AudioManager';
import type { LLMService } from '../llm/LLMService';
import type { SessionManager } from '../session/SessionManager';
import type { TranscriptionService } from '../transcription/TranscriptionService';
import { emit } from '../ipc';
import { logger } from '../logger';
import { DEFAULT_PROMPTS, renderTemplate } from '../prompts';
import { STATIC_BANKS, pickStatic, type BankQuestion, type PracticeSetId } from './questionBank';

const log = logger.scope('practice');

export interface PracticeDeps {
  llm: LLMService;
  db: SessionDB;
  sessions: SessionManager;
  audio: AudioManager;
  transcription: TranscriptionService;
  getSettings: () => Settings;
}

/** JSON schema for the scorer — mirrors PracticeScore['score'] exactly. */
export const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    relevance: { type: 'number' },
    structure: { type: 'number' },
    specificity: { type: 'number' },
    conciseness: { type: 'number' },
    strengths: { type: 'array', items: { type: 'string' } },
    improve_one_thing: { type: 'string' },
    model_answer: { type: 'string' },
  },
  required: ['score', 'relevance', 'structure', 'specificity', 'conciseness', 'strengths', 'improve_one_thing', 'model_answer'],
  additionalProperties: false,
} as const;

const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: { questions: { type: 'array', items: { type: 'string' } } },
  required: ['questions'],
  additionalProperties: false,
} as const;

interface Run {
  sessionId: string;
  profile: Profile | null;
  questions: BankQuestion[];
  index: number;
  scores: PracticeScore[];
  busy: boolean;
}

function clamp10(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : Number(n);
  if (!Number.isFinite(v)) return 5;
  return Math.min(10, Math.max(1, Math.round(v)));
}

/**
 * Practice mode (M11): AI interviewer asks questions (text + TTS in the renderer), listens to
 * the spoken answer on the ME channel, scores it with the fast model, keeps history per profile.
 *
 * Events mirror what is pushed to the renderer: 'event' (PracticeEvent).
 */
export class PracticeService extends EventEmitter {
  private run: Run | null = null;

  constructor(private deps: PracticeDeps) {
    super();
    // If the session is ended elsewhere (End button on Live, app quit) drop our state.
    deps.sessions.on('ended', (s: { id: string }) => {
      if (this.run && this.run.sessionId === s.id) {
        this.run = null;
      }
    });
  }

  get active(): boolean {
    return !!this.run;
  }

  async sets(profileId: string | null): Promise<PracticeQuestionSet[]> {
    const profile = profileId ? this.deps.db.getProfile(profileId) : null;
    const hasJd = !!profile?.jdText?.trim();
    return [
      { id: 'behavioral', label: STATIC_BANKS.behavioral.label, description: STATIC_BANKS.behavioral.description },
      {
        id: 'role',
        label: 'Role-specific (from the job description)',
        description: hasJd
          ? `Questions generated for ${profile?.role || 'the role'}${profile?.company ? ` at ${profile.company}` : ''} from the JD and your résumé.`
          : 'Needs a profile with a job description — falls back to common behavioral questions.',
      },
      { id: 'coding', label: STATIC_BANKS.coding.label, description: STATIC_BANKS.coding.description },
      { id: 'system_design', label: STATIC_BANKS.system_design.label, description: STATIC_BANKS.system_design.description },
    ];
  }

  async start(opts: { profileId: string | null; setId: string; count: number; useTts: boolean }): Promise<SessionState> {
    if (this.run) await this.stop();
    const profile = opts.profileId ? this.deps.db.getProfile(opts.profileId) : null;
    const count = Math.min(20, Math.max(1, Math.round(opts.count) || 5));
    const questions = await this.pickQuestions(opts.setId as PracticeSetId, count, profile);
    const state = this.deps.sessions.start(profile?.id ?? null, 'practice');
    const sessionId = state.session?.id;
    if (!sessionId) throw new Error('Could not create a practice session');
    this.run = { sessionId, profile, questions, index: 0, scores: [], busy: false };
    try {
      await this.deps.audio.start({ them: false });
      this.deps.sessions.setListening(true);
    } catch (err) {
      log.warn('mic start failed', err);
      this.push({ type: 'error', error: `Microphone could not start: ${err instanceof Error ? err.message : String(err)}` });
    }
    log.info(`practice started: ${opts.setId} × ${questions.length}${profile ? ` (${profile.name})` : ''}`);
    this.askCurrent();
    return this.deps.sessions.state();
  }

  async submit(answerText: string): Promise<void> {
    const run = this.run;
    if (!run || run.busy) return;
    const q = run.questions[run.index];
    if (!q) return;
    const answer = answerText.trim();
    if (!answer) {
      this.push({ type: 'error', error: 'Say (or type) an answer before submitting.' });
      return;
    }
    run.busy = true;
    this.push({ type: 'scoring' });
    try {
      const score = await this.score(run, q, answer);
      const entry: PracticeScore = { id: uid('ps'), sessionId: run.sessionId, question: q.question, answer, score, createdAt: Date.now() };
      this.deps.db.savePracticeScore(entry);
      run.scores.push(entry);
      this.push({ type: 'score', score: entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('scoring failed', message);
      this.push({ type: 'error', error: `Scoring failed: ${message}` });
      emit('toast', { kind: 'error', title: 'Could not score the answer', message });
    } finally {
      run.busy = false;
    }
    if (this.run === run) await this.advance();
  }

  async skip(): Promise<void> {
    if (!this.run || this.run.busy) return;
    await this.advance();
  }

  async stop(): Promise<void> {
    await this.finish();
  }

  history(profileId: string | null): PracticeHistoryEntry[] {
    return this.deps.db
      .listPracticeSessions(profileId)
      .map((s) => {
        const scores = this.deps.db.listPracticeScores(s.id);
        const avg = scores.length ? scores.reduce((a, b) => a + b.score.score, 0) / scores.length : 0;
        return { sessionId: s.id, startedAt: s.startedAt, endedAt: s.endedAt, count: scores.length, avgScore: Math.round(avg * 10) / 10, scores };
      })
      .filter((h) => h.count > 0);
  }

  // ----- internals -----
  private push(ev: PracticeEvent): void {
    emit('practice:event', ev);
    this.emit('event', ev);
  }

  private askCurrent(): void {
    const run = this.run;
    if (!run) return;
    const q = run.questions[run.index];
    if (!q) {
      void this.finish();
      return;
    }
    this.push({ type: 'question', index: run.index, total: run.questions.length, question: q.question, category: q.category });
  }

  private async advance(): Promise<void> {
    const run = this.run;
    if (!run) return;
    run.index++;
    if (run.index >= run.questions.length) await this.finish();
    else this.askCurrent();
  }

  private async finish(): Promise<void> {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.push({ type: 'finished' });
    try {
      await this.deps.audio.stop();
    } catch {
      /* ignore */
    }
    if (this.deps.sessions.session?.id === run.sessionId) this.deps.sessions.stop();
    log.info(`practice finished: ${run.scores.length} scored of ${run.questions.length}`);
  }

  private async pickQuestions(setId: PracticeSetId, count: number, profile: Profile | null): Promise<BankQuestion[]> {
    if (setId === 'role') {
      const generated = await this.generateRoleQuestions(count, profile);
      if (generated.length) return generated;
      emit('toast', { kind: 'info', title: 'Using common behavioral questions', message: 'Role-specific questions need a profile with a job description and a working Anthropic key.' });
      return pickStatic('behavioral', count);
    }
    if (setId in STATIC_BANKS) return pickStatic(setId as Exclude<PracticeSetId, 'role'>, count);
    return pickStatic('behavioral', count);
  }

  private async generateRoleQuestions(count: number, profile: Profile | null): Promise<BankQuestion[]> {
    if (!profile?.jdText?.trim()) return [];
    const s = this.deps.getSettings();
    const system = renderTemplate(s.prompts.practice_interviewer ?? DEFAULT_PROMPTS.practice_interviewer, {
      company: profile.company || 'the company',
      role: profile.role || 'the role',
      interview_type: profile.type.replace('_', ' '),
      count: String(count),
      category: profile.type === 'technical' || profile.type === 'system_design' ? 'technical and role-specific' : 'role-specific behavioral and situational',
      jd_text: profile.jdText,
      resume_text: profile.resumeText || '(no résumé)',
    });
    try {
      const out = await this.deps.llm.json<{ questions?: unknown }>({
        model: s.models.heavy,
        system,
        user: `Generate exactly ${count} questions now.`,
        schema: QUESTIONS_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'practice_questions',
        maxTokens: 1200,
      });
      const qs = Array.isArray(out.questions) ? out.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 8) : [];
      return qs.slice(0, count).map((question) => ({ question: question.trim(), category: 'role' }));
    } catch (err) {
      log.warn('role question generation failed', err);
      return [];
    }
  }

  private async score(run: Run, q: BankQuestion, answer: string): Promise<PracticeScore['score']> {
    const s = this.deps.getSettings();
    const p = run.profile;
    const system = renderTemplate(s.prompts.practice_scorer ?? DEFAULT_PROMPTS.practice_scorer, {
      role: p?.role || 'the role being discussed',
      company: p?.company || 'the company',
      interview_type: (p?.type ?? 'general').replace('_', ' '),
      resume_text: p?.resumeText || '(no résumé — do not invent experience)',
      stories: p?.stories?.length ? p.stories.map((st) => `### ${st.title}\n${st.text}`).join('\n\n') : '(none)',
    });
    const user = `Question (${q.category}): ${q.question}\n\nCandidate's spoken answer (transcribed):\n${answer}`;
    const raw = await this.deps.llm.json<Partial<PracticeScore['score']>>({
      model: s.models.heavy,
      system,
      user,
      schema: SCORE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'practice_score',
      maxTokens: 900,
    });
    return {
      score: clamp10(raw.score),
      relevance: clamp10(raw.relevance),
      structure: clamp10(raw.structure),
      specificity: clamp10(raw.specificity),
      conciseness: clamp10(raw.conciseness),
      strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
      improve_one_thing: typeof raw.improve_one_thing === 'string' ? raw.improve_one_thing : '',
      model_answer: typeof raw.model_answer === 'string' ? raw.model_answer : '',
    };
  }
}
