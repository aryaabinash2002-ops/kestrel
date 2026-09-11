import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AnswerCard,
  Profile,
  ScreenshotResult,
  Session,
  SessionSummary,
  Utterance,
} from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import { formatMs } from '@shared/utils';
import type { SessionDB } from '../db';
import type { LLMService } from '../llm/LLMService';
import type { Paths } from '../paths';
import type { WindowManager } from '../windows';
import { logger } from '../logger';
import { DEFAULT_PROMPTS, renderTemplate } from '../prompts';

const log = logger.scope('review');

export interface ReviewDeps {
  llm: LLMService;
  db: SessionDB;
  paths: Paths;
  windows: WindowManager;
  getSettings: () => Settings;
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    weakSpots: { type: 'array', items: { type: 'string' } },
    followUpEmail: { type: 'string' },
    actionItems: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'questions', 'weakSpots', 'followUpEmail', 'actionItems'],
  additionalProperties: false,
} as const;

interface RawReview {
  summary?: unknown;
  questions?: unknown;
  weakSpots?: unknown;
  followUpEmail?: unknown;
  actionItems?: unknown;
}

/** Everything needed to render a review document. */
export interface ReviewDocument {
  session: Session;
  profile: Profile | null;
  utterances: Utterance[];
  answers: AnswerCard[];
  screenshots: ScreenshotResult[];
  summary: SessionSummary | null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((s) => s.trim())
    : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function fileStamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function durationLabel(session: Session): string {
  if (!session.endedAt) return 'in progress';
  return formatMs(session.endedAt - session.startedAt);
}

function titleOf(doc: ReviewDocument): string {
  const p = doc.profile;
  const bits = [p?.name, [p?.role, p?.company].filter(Boolean).join(' @ ')].filter(Boolean);
  return bits.length
    ? bits.join(' — ')
    : doc.session.mode === 'practice'
      ? 'Practice session'
      : 'Live session';
}

/**
 * Transcript + suggested answers merged in time order, one line each, e.g.
 *   [01:23] THEM: Tell me about yourself
 *   [01:25] AI (suggested): Headline — point; point
 */
export function transcriptText(
  session: Session,
  utterances: Utterance[],
  answers: AnswerCard[],
): string {
  const lines: { ms: number; text: string }[] = utterances
    .filter((u) => u.isFinal)
    .map((u) => ({
      ms: u.startMs,
      text: `[${formatMs(u.startMs)}] ${u.speaker}${u.speakerName ? ` (${u.speakerName})` : ''}: ${u.text}`,
    }));
  for (const a of answers) {
    if (a.status !== 'done' || a.kind === 'chat' || !a.headline) continue;
    const ms = Math.max(0, a.createdAt - session.startedAt);
    const points = a.points.length ? ` — ${a.points.join('; ')}` : '';
    lines.push({
      ms,
      text: `[${formatMs(ms)}] AI (suggested for "${a.question.slice(0, 80)}"): ${a.headline}${points}`,
    });
  }
  return lines
    .sort((a, b) => a.ms - b.ms)
    .map((l) => l.text)
    .join('\n');
}

/** Markdown export of a whole session. */
export function renderMarkdown(doc: ReviewDocument): string {
  const { session, summary, answers, screenshots, utterances } = doc;
  const out: string[] = [];
  out.push(`# Kestrel review — ${titleOf(doc)}`);
  out.push('');
  out.push(`- Date: ${new Date(session.startedAt).toLocaleString()}`);
  out.push(`- Duration: ${durationLabel(session)}`);
  out.push(`- Mode: ${session.mode}`);
  if (doc.profile)
    out.push(`- Profile: ${doc.profile.name} (${doc.profile.type.replace('_', ' ')})`);
  out.push('');
  if (summary) {
    out.push('## Summary', '', summary.summary, '');
    out.push(
      '## Questions asked',
      '',
      ...(summary.questions.length
        ? summary.questions.map((q, i) => `${i + 1}. ${q}`)
        : ['_None detected._']),
      '',
    );
    out.push(
      '## Weak spots',
      '',
      ...(summary.weakSpots.length ? summary.weakSpots.map((w) => `- ${w}`) : ['_None noted._']),
      '',
    );
    out.push('## Follow-up email', '', summary.followUpEmail || '_Not generated._', '');
    out.push(
      '## Action items',
      '',
      ...(summary.actionItems.length ? summary.actionItems.map((a) => `- [ ] ${a}`) : ['_None._']),
      '',
    );
  } else {
    out.push(
      '> No AI review was generated for this session. Open it in Kestrel → Review and press **Generate review**.',
      '',
    );
  }
  const done = answers.filter((a) => a.status === 'done' && a.headline);
  out.push('## Suggested answers', '');
  if (!done.length) out.push('_No answers were suggested._', '');
  for (const a of done) {
    const ms = Math.max(0, a.createdAt - session.startedAt);
    out.push(`### [${formatMs(ms)}] ${a.kind === 'chat' ? 'Follow-up: ' : ''}${a.question}`);
    out.push('', `**${a.headline}**`, '');
    for (const p of a.points) out.push(`- ${p}`);
    if (a.kind === 'chat' && a.content) out.push(a.content.split('\n').slice(1).join('\n').trim());
    out.push('');
  }
  if (screenshots.length) {
    out.push('## Screenshots', '');
    for (const s of screenshots) {
      out.push(`### ${new Date(s.createdAt).toLocaleTimeString()} — ${s.path}`, '');
      if (s.result) out.push(s.result, '');
    }
  }
  out.push('## Full transcript', '');
  const t = transcriptText(
    session,
    utterances,
    answers.filter((a) => a.kind !== 'chat'),
  );
  out.push(t || '_Empty transcript._', '');
  return out.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal Markdown → HTML for the PDF export (headings, lists, bold, code fences, paragraphs). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let inCode = false;
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/_(.+?)_/g, '<i>$1</i>');
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      closeList();
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(esc(raw));
      continue;
    }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      html.push(`<h${h[1]!.length}>${inline(h[2] ?? '')}</h${h[1]!.length}>`);
      continue;
    }
    if (/^>\s?/.test(raw)) {
      closeList();
      html.push(`<blockquote>${inline(raw.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    const ul = raw.match(/^\s*[-*]\s+(?:\[[ x]\]\s+)?(.*)$/);
    if (ul) {
      if (list !== 'ul') {
        closeList();
        html.push('<ul>');
        list = 'ul';
      }
      html.push(`<li>${inline(ul[1] ?? '')}</li>`);
      continue;
    }
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (list !== 'ol') {
        closeList();
        html.push('<ol>');
        list = 'ol';
      }
      html.push(`<li>${inline(ol[1] ?? '')}</li>`);
      continue;
    }
    closeList();
    if (!raw.trim()) continue;
    html.push(`<p>${inline(raw)}</p>`);
  }
  closeList();
  if (inCode) html.push('</code></pre>');
  return html.join('\n');
}

export function renderHtml(doc: ReviewDocument): string {
  const body = markdownToHtml(renderMarkdown(doc));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kestrel review</title>
<style>
  body { font: 11pt/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1d24; margin: 0; padding: 0 4mm; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #d9dbe1; padding-bottom: 3pt; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  p { margin: 4pt 0; white-space: pre-wrap; }
  ul, ol { margin: 4pt 0 4pt 18pt; padding: 0; }
  li { margin: 2pt 0; }
  blockquote { margin: 6pt 0; padding: 6pt 10pt; background: #f3f4f7; border-left: 3px solid #f5a524; }
  pre { background: #f3f4f7; padding: 8pt; border-radius: 4pt; font: 9.5pt Menlo, Consolas, monospace; white-space: pre-wrap; }
  code { font: 9.5pt Menlo, Consolas, monospace; }
</style></head><body>${body}</body></html>`;
}

/**
 * Post-session review (M10): generates summary / questions / weak spots / follow-up email /
 * action items with the strong model and exports sessions to Markdown or PDF.
 */
export class ReviewService {
  constructor(private deps: ReviewDeps) {}

  /** Load everything about a session from the database. */
  document(sessionId: string): ReviewDocument {
    const { db } = this.deps;
    const session = db.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    return {
      session,
      profile: session.profileId ? db.getProfile(session.profileId) : null,
      utterances: db.listUtterances(sessionId, true),
      answers: db.listAnswers(sessionId),
      screenshots: db.listScreenshots(sessionId),
      summary: session.summary,
    };
  }

  async generate(sessionId: string): Promise<SessionSummary> {
    const { llm, db, getSettings } = this.deps;
    const doc = this.document(sessionId);
    if (doc.utterances.length === 0) {
      throw new Error('This session has no transcript to review — nothing was transcribed.');
    }
    const settings = getSettings();
    const p = doc.profile;
    const system = renderTemplate(settings.prompts.review ?? DEFAULT_PROMPTS.review, {
      user_name: p?.userName || 'the user',
      role: p?.role || 'the role being discussed',
      company: p?.company || 'the company',
      interview_type: (p?.type ?? 'general').replace('_', ' '),
      language: p?.language || settings.defaults.language,
    });
    const transcript = transcriptText(doc.session, doc.utterances, doc.answers);
    const t0 = Date.now();
    const raw = await llm.json<RawReview>({
      model: settings.models.heavy,
      system,
      user: `<transcript>\n${transcript}\n</transcript>`,
      schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'session_review',
      maxTokens: 2000,
    });
    const summary: SessionSummary = {
      summary: str(raw.summary),
      questions: strArr(raw.questions),
      weakSpots: strArr(raw.weakSpots),
      followUpEmail: str(raw.followUpEmail),
      actionItems: strArr(raw.actionItems),
      generatedAt: Date.now(),
    };
    if (!summary.summary) throw new Error('The model returned an empty review — please try again.');
    db.setSessionSummary(sessionId, summary);
    log.info(
      `review generated for ${sessionId} in ${Date.now() - t0} ms (${summary.questions.length} questions, ${summary.weakSpots.length} weak spots)`,
    );
    return summary;
  }

  async export(sessionId: string, format: 'md' | 'pdf'): Promise<{ path: string }> {
    const doc = this.document(sessionId);
    const base = `kestrel-review-${fileStamp(doc.session.startedAt)}${doc.profile ? `-${slug(doc.profile.name)}` : ''}`;
    const path = join(this.deps.paths.exportsDir, `${base}.${format}`);
    if (format === 'md') {
      writeFileSync(path, renderMarkdown(doc), 'utf8');
    } else {
      writeFileSync(path, await this.pdf(renderHtml(doc)));
    }
    log.info('exported', path);
    return { path };
  }

  private async pdf(html: string): Promise<Buffer> {
    const { BrowserWindow } = await import('electron');
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      const loaded = new Promise<void>((resolve, reject) => {
        win.webContents.once('did-finish-load', () => resolve());
        win.webContents.once('did-fail-load', (_e, code, desc) =>
          reject(new Error(`PDF render failed (${code} ${desc})`)),
        );
      });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await loaded;
      return await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      });
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }
}
