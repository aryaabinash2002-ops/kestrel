import Database from 'better-sqlite3';
import type {
  AnswerCard,
  LatencySample,
  PracticeScore,
  Profile,
  ScreenshotResult,
  Session,
  SessionSummary,
  Story,
  Utterance,
} from '@shared/types/session';
import { uid } from '@shared/utils';
import { logger } from './logger';

const log = logger.scope('db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'general',
  language TEXT NOT NULL DEFAULT 'English',
  length TEXT NOT NULL DEFAULT 'short',
  tone TEXT NOT NULL DEFAULT 'confident',
  resume_text TEXT NOT NULL DEFAULT '',
  jd_text TEXT NOT NULL DEFAULT '',
  stories TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS utterances (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'stt',
  speaker_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_utterances_session ON utterances(session_id, start_ms);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  type TEXT,
  content TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  points_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER,
  latency_json TEXT,
  kind TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'done',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id, created_at);
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  path TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_scores (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  score_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS latency_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id TEXT,
  question_end_ts INTEGER,
  request_start_ts INTEGER,
  first_token_ts INTEGER,
  headline_done_ts INTEGER,
  speculative INTEGER NOT NULL DEFAULT 0,
  restarted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

interface ProfileRow {
  id: string;
  name: string;
  role: string;
  company: string;
  type: string;
  language: string;
  length: string;
  tone: string;
  resume_text: string;
  jd_text: string;
  stories: string;
  notes: string;
  user_name: string;
  created_at: number;
  updated_at: number;
}
interface SessionRow {
  id: string;
  profile_id: string | null;
  mode: string;
  started_at: number;
  ended_at: number | null;
  summary_json: string | null;
}
interface UtteranceRow {
  id: string;
  session_id: string;
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
  is_final: number;
  source: string;
  speaker_name: string | null;
}
interface AnswerRow {
  id: string;
  session_id: string;
  question: string;
  type: string | null;
  content: string;
  headline: string;
  points_json: string;
  model: string;
  latency_ms: number | null;
  latency_json: string | null;
  kind: string;
  status: string;
  created_at: number;
}
interface ScreenshotRow {
  id: string;
  session_id: string | null;
  path: string;
  result: string;
  created_at: number;
}
interface PracticeRow {
  id: string;
  session_id: string;
  question: string;
  answer: string;
  score_json: string;
  created_at: number;
}
interface LatencyRow {
  id: number;
  answer_id: string | null;
  question_end_ts: number | null;
  request_start_ts: number;
  first_token_ts: number | null;
  headline_done_ts: number | null;
  speculative: number;
  restarted: number;
  created_at: number;
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export class SessionDB {
  private db: Database.Database;

  constructor(private file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    log.info('opened', file);
  }

  close(): void {
    this.db.close();
  }

  get path(): string {
    return this.file;
  }

  // ---------- profiles ----------
  private rowToProfile(r: ProfileRow): Profile {
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      company: r.company,
      type: r.type as Profile['type'],
      language: r.language,
      length: r.length as Profile['length'],
      tone: r.tone as Profile['tone'],
      resumeText: r.resume_text,
      jdText: r.jd_text,
      stories: safeJson<Story[]>(r.stories, []),
      notes: r.notes,
      userName: r.user_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listProfiles(): Profile[] {
    return (
      this.db.prepare('SELECT * FROM profiles ORDER BY updated_at DESC').all() as ProfileRow[]
    ).map((r) => this.rowToProfile(r));
  }

  getProfile(id: string): Profile | null {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as
      ProfileRow | undefined;
    return r ? this.rowToProfile(r) : null;
  }

  saveProfile(p: Partial<Profile> & { id?: string }): Profile {
    const now = Date.now();
    const existing = p.id ? this.getProfile(p.id) : null;
    const merged: Profile = {
      id: existing?.id ?? p.id ?? uid('prof'),
      name: p.name ?? existing?.name ?? 'Untitled profile',
      role: p.role ?? existing?.role ?? '',
      company: p.company ?? existing?.company ?? '',
      type: p.type ?? existing?.type ?? 'general',
      language: p.language ?? existing?.language ?? 'English',
      length: p.length ?? existing?.length ?? 'short',
      tone: p.tone ?? existing?.tone ?? 'confident',
      resumeText: p.resumeText ?? existing?.resumeText ?? '',
      jdText: p.jdText ?? existing?.jdText ?? '',
      stories: p.stories ?? existing?.stories ?? [],
      notes: p.notes ?? existing?.notes ?? '',
      userName: p.userName ?? existing?.userName ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO profiles (id,name,role,company,type,language,length,tone,resume_text,jd_text,stories,notes,user_name,created_at,updated_at)
         VALUES (@id,@name,@role,@company,@type,@language,@length,@tone,@resume_text,@jd_text,@stories,@notes,@user_name,@created_at,@updated_at)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, company=excluded.company, type=excluded.type,
           language=excluded.language, length=excluded.length, tone=excluded.tone, resume_text=excluded.resume_text,
           jd_text=excluded.jd_text, stories=excluded.stories, notes=excluded.notes, user_name=excluded.user_name, updated_at=excluded.updated_at`,
      )
      .run({
        id: merged.id,
        name: merged.name,
        role: merged.role,
        company: merged.company,
        type: merged.type,
        language: merged.language,
        length: merged.length,
        tone: merged.tone,
        resume_text: merged.resumeText,
        jd_text: merged.jdText,
        stories: JSON.stringify(merged.stories),
        notes: merged.notes,
        user_name: merged.userName,
        created_at: merged.createdAt,
        updated_at: merged.updatedAt,
      });
    return merged;
  }

  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  }

  // ---------- sessions ----------
  private rowToSession(r: SessionRow): Session {
    return {
      id: r.id,
      profileId: r.profile_id,
      mode: r.mode as Session['mode'],
      startedAt: r.started_at,
      endedAt: r.ended_at,
      summary: safeJson<SessionSummary | null>(r.summary_json, null),
    };
  }

  createSession(profileId: string | null, mode: Session['mode']): Session {
    const s: Session = {
      id: uid('sess'),
      profileId,
      mode,
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
    };
    this.db
      .prepare('INSERT INTO sessions (id, profile_id, mode, started_at) VALUES (?, ?, ?, ?)')
      .run(s.id, s.profileId, s.mode, s.startedAt);
    return s;
  }

  endSession(id: string): void {
    this.db
      .prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(Date.now(), id);
  }

  getSession(id: string): Session | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      SessionRow | undefined;
    return r ? this.rowToSession(r) : null;
  }

  listSessions(): (Session & {
    profileName: string | null;
    utteranceCount: number;
    answerCount: number;
  })[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, p.name AS profile_name,
           (SELECT COUNT(*) FROM utterances u WHERE u.session_id = s.id AND u.is_final = 1) AS utterance_count,
           (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS answer_count
         FROM sessions s LEFT JOIN profiles p ON p.id = s.profile_id
         ORDER BY s.started_at DESC`,
      )
      .all() as (SessionRow & {
      profile_name: string | null;
      utterance_count: number;
      answer_count: number;
    })[];
    return rows.map((r) => ({
      ...this.rowToSession(r),
      profileName: r.profile_name,
      utteranceCount: r.utterance_count,
      answerCount: r.answer_count,
    }));
  }

  setSessionSummary(id: string, summary: SessionSummary): void {
    this.db
      .prepare('UPDATE sessions SET summary_json = ? WHERE id = ?')
      .run(JSON.stringify(summary), id);
  }

  deleteSession(id: string): void {
    const tx = this.db.transaction((sid: string) => {
      this.db.prepare('DELETE FROM utterances WHERE session_id = ?').run(sid);
      this.db.prepare('DELETE FROM answers WHERE session_id = ?').run(sid);
      this.db.prepare('DELETE FROM screenshots WHERE session_id = ?').run(sid);
      this.db.prepare('DELETE FROM practice_scores WHERE session_id = ?').run(sid);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    });
    tx(id);
  }

  // ---------- utterances ----------
  private rowToUtterance(r: UtteranceRow): Utterance {
    return {
      id: r.id,
      sessionId: r.session_id,
      speaker: r.speaker as Utterance['speaker'],
      text: r.text,
      startMs: r.start_ms,
      endMs: r.end_ms,
      isFinal: r.is_final === 1,
      source: r.source as Utterance['source'],
      speakerName: r.speaker_name ?? undefined,
    };
  }

  upsertUtterance(u: Utterance): void {
    this.db
      .prepare(
        `INSERT INTO utterances (id, session_id, speaker, text, start_ms, end_ms, is_final, source, speaker_name)
         VALUES (@id,@session_id,@speaker,@text,@start_ms,@end_ms,@is_final,@source,@speaker_name)
         ON CONFLICT(id) DO UPDATE SET text=excluded.text, end_ms=excluded.end_ms, is_final=excluded.is_final, speaker_name=excluded.speaker_name`,
      )
      .run({
        id: u.id,
        session_id: u.sessionId,
        speaker: u.speaker,
        text: u.text,
        start_ms: u.startMs,
        end_ms: u.endMs,
        is_final: u.isFinal ? 1 : 0,
        source: u.source,
        speaker_name: u.speakerName ?? null,
      });
  }

  deleteUtterance(id: string): void {
    this.db.prepare('DELETE FROM utterances WHERE id = ?').run(id);
  }

  listUtterances(sessionId: string, finalOnly = true): Utterance[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM utterances WHERE session_id = ? ${finalOnly ? 'AND is_final = 1' : ''} ORDER BY start_ms ASC`,
      )
      .all(sessionId) as UtteranceRow[];
    return rows.map((r) => this.rowToUtterance(r));
  }

  // ---------- answers ----------
  private rowToAnswer(r: AnswerRow): AnswerCard {
    const latency = safeJson<AnswerCard['latency'] | null>(r.latency_json, null);
    return {
      id: r.id,
      sessionId: r.session_id,
      question: r.question,
      type: (r.type as AnswerCard['type']) ?? null,
      headline: r.headline,
      points: safeJson<string[]>(r.points_json, []),
      content: r.content,
      model: r.model,
      status: r.status as AnswerCard['status'],
      latency: latency ?? {
        questionEndTs: null,
        requestStartTs: r.created_at,
        firstTokenTs: null,
        headlineDoneTs: null,
        doneTs: null,
        speculative: false,
        restarted: false,
      },
      kind: r.kind as AnswerCard['kind'],
      createdAt: r.created_at,
    };
  }

  saveAnswer(a: AnswerCard): void {
    const latencyMs =
      a.latency.firstTokenTs && a.latency.questionEndTs
        ? a.latency.firstTokenTs - a.latency.questionEndTs
        : null;
    this.db
      .prepare(
        `INSERT INTO answers (id, session_id, question, type, content, headline, points_json, model, latency_ms, latency_json, kind, status, created_at)
         VALUES (@id,@session_id,@question,@type,@content,@headline,@points_json,@model,@latency_ms,@latency_json,@kind,@status,@created_at)
         ON CONFLICT(id) DO UPDATE SET question=excluded.question, type=excluded.type, content=excluded.content, headline=excluded.headline,
           points_json=excluded.points_json, model=excluded.model, latency_ms=excluded.latency_ms, latency_json=excluded.latency_json,
           kind=excluded.kind, status=excluded.status`,
      )
      .run({
        id: a.id,
        session_id: a.sessionId,
        question: a.question,
        type: a.type,
        content: a.content,
        headline: a.headline,
        points_json: JSON.stringify(a.points),
        model: a.model,
        latency_ms: latencyMs,
        latency_json: JSON.stringify(a.latency),
        kind: a.kind,
        status: a.status,
        created_at: a.createdAt,
      });
  }

  listAnswers(sessionId: string): AnswerCard[] {
    return (
      this.db
        .prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId) as AnswerRow[]
    ).map((r) => this.rowToAnswer(r));
  }

  // ---------- screenshots ----------
  saveScreenshot(s: ScreenshotResult): void {
    this.db
      .prepare(
        `INSERT INTO screenshots (id, session_id, path, result, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET result = excluded.result`,
      )
      .run(s.id, s.sessionId, s.path, s.result, s.createdAt);
  }

  listScreenshots(sessionId: string): ScreenshotResult[] {
    return (
      this.db
        .prepare('SELECT * FROM screenshots WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId) as ScreenshotRow[]
    ).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      path: r.path,
      result: r.result,
      status: 'done',
      createdAt: r.created_at,
    }));
  }

  // ---------- practice ----------
  savePracticeScore(p: PracticeScore): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO practice_scores (id, session_id, question, answer, score_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(p.id, p.sessionId, p.question, p.answer, JSON.stringify(p.score), p.createdAt);
  }

  listPracticeScores(sessionId: string): PracticeScore[] {
    return (
      this.db
        .prepare('SELECT * FROM practice_scores WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId) as PracticeRow[]
    ).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      question: r.question,
      answer: r.answer,
      score: safeJson<PracticeScore['score']>(r.score_json, {
        score: 0,
        relevance: 0,
        structure: 0,
        specificity: 0,
        conciseness: 0,
        strengths: [],
        improve_one_thing: '',
        model_answer: '',
      }),
      createdAt: r.created_at,
    }));
  }

  listPracticeSessions(profileId: string | null): Session[] {
    const rows = (
      profileId
        ? this.db
            .prepare(
              "SELECT * FROM sessions WHERE mode = 'practice' AND profile_id = ? ORDER BY started_at DESC",
            )
            .all(profileId)
        : this.db
            .prepare("SELECT * FROM sessions WHERE mode = 'practice' ORDER BY started_at DESC")
            .all()
    ) as SessionRow[];
    return rows.map((r) => this.rowToSession(r));
  }

  // ---------- latency ----------
  saveLatency(s: LatencySample): void {
    this.db
      .prepare(
        `INSERT INTO latency_samples (answer_id, question_end_ts, request_start_ts, first_token_ts, headline_done_ts, speculative, restarted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.answerId,
        s.questionEndTs,
        s.requestStartTs,
        s.firstTokenTs,
        s.headlineDoneTs,
        s.speculative ? 1 : 0,
        s.restarted ? 1 : 0,
        s.createdAt,
      );
  }

  listLatency(limit = 500): LatencySample[] {
    return (
      this.db
        .prepare('SELECT * FROM latency_samples ORDER BY created_at DESC LIMIT ?')
        .all(limit) as LatencyRow[]
    ).map((r) => ({
      answerId: r.answer_id ?? '',
      questionEndTs: r.question_end_ts,
      requestStartTs: r.request_start_ts,
      firstTokenTs: r.first_token_ts,
      headlineDoneTs: r.headline_done_ts,
      speculative: r.speculative === 1,
      restarted: r.restarted === 1,
      createdAt: r.created_at,
    }));
  }

  clearLatency(): void {
    this.db.prepare('DELETE FROM latency_samples').run();
  }

  // ---------- meta ----------
  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  /** Drop every row (used by "Delete all data"). */
  wipe(): void {
    this.db.exec(
      'DELETE FROM utterances; DELETE FROM answers; DELETE FROM screenshots; DELETE FROM practice_scores; DELETE FROM latency_samples; DELETE FROM sessions; DELETE FROM profiles; DELETE FROM meta;',
    );
    this.db.exec('VACUUM');
  }
}
