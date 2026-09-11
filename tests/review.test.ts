import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/types/settings';
import type { AnswerCard } from '@shared/types/session';
import { startFakeAnthropic, type FakeAnthropic } from './fakes/fakeAnthropic';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
}));

const { SessionDB } = await import('@main/db');
const { LLMService } = await import('@main/llm/LLMService');
const { ReviewService, renderMarkdown, markdownToHtml, transcriptText } =
  await import('@main/review/ReviewService');

let fake: FakeAnthropic;
let exportsDir: string;
beforeEach(async () => {
  fake = await startFakeAnthropic({ tokenDelayMs: 1, firstTokenDelayMs: 5 });
  process.env['KESTREL_ANTHROPIC_BASE_URL'] = fake.url;
  exportsDir = mkdtempSync(join(tmpdir(), 'kestrel-exports-'));
});
afterEach(async () => {
  await fake.close();
  delete process.env['KESTREL_ANTHROPIC_BASE_URL'];
  rmSync(exportsDir, { recursive: true, force: true });
});

function seed() {
  const db = new SessionDB(':memory:');
  const profile = db.saveProfile({
    name: 'Acme — Senior Engineer',
    userName: 'Jane',
    role: 'Senior Software Engineer',
    company: 'Acme',
    type: 'behavioral',
    language: 'English',
  });
  const session = db.createSession(profile.id, 'live');
  const startedAt = session.startedAt;
  db.upsertUtterance({
    id: 'u1',
    sessionId: session.id,
    speaker: 'THEM',
    text: 'Tell me about a time you led a migration.',
    startMs: 5000,
    endMs: 8000,
    isFinal: true,
    source: 'stt',
  });
  db.upsertUtterance({
    id: 'u2',
    sessionId: session.id,
    speaker: 'ME',
    text: 'At Globex I led the billing migration to Stripe.',
    startMs: 9000,
    endMs: 15000,
    isFinal: true,
    source: 'stt',
  });
  db.upsertUtterance({
    id: 'u3',
    sessionId: session.id,
    speaker: 'THEM',
    text: 'What was the result?',
    startMs: 16000,
    endMs: 17000,
    isFinal: true,
    source: 'stt',
  });
  db.upsertUtterance({
    id: 'u4',
    sessionId: session.id,
    speaker: 'ME',
    text: 'Failures went from twelve percent to one.',
    startMs: 18000,
    endMs: 21000,
    isFinal: true,
    source: 'stt',
  });
  const card: AnswerCard = {
    id: 'ans_1',
    sessionId: session.id,
    question: 'Tell me about a time you led a migration.',
    type: 'behavioral',
    headline: 'At Globex I led the billing migration to Stripe with zero downtime.',
    points: ['Situation: legacy invoicing', 'Result: failures down to 1%'],
    content: '',
    model: 'claude-haiku-4-5-20251001',
    status: 'done',
    latency: {
      questionEndTs: startedAt + 8000,
      requestStartTs: startedAt + 8100,
      firstTokenTs: startedAt + 8400,
      headlineDoneTs: startedAt + 8600,
      doneTs: startedAt + 9200,
      speculative: true,
      restarted: false,
    },
    kind: 'auto',
    createdAt: startedAt + 8100,
  };
  db.saveAnswer(card);
  db.saveScreenshot({
    id: 'shot_1',
    sessionId: session.id,
    path: '/tmp/shot_1.png',
    result: '## Problem\nTwo-sum.',
    status: 'done',
    createdAt: startedAt + 30000,
  });
  db.endSession(session.id);
  return { db, session, profile };
}

function service(db: InstanceType<typeof SessionDB>) {
  const llm = new LLMService({ get: async () => 'test-key' } as never);
  return new ReviewService({
    llm,
    db,
    paths: { exportsDir } as never,
    windows: {} as never,
    getSettings: () => DEFAULT_SETTINGS,
  });
}

describe('ReviewService', () => {
  it('generates and stores a review from the transcript + answers using the strong model', async () => {
    const { db, session } = seed();
    const svc = service(db);
    const summary = await svc.generate(session.id);
    expect(summary.summary).toBe('A solid conversation.');
    expect(summary.questions.length).toBeGreaterThan(0);
    expect(summary.weakSpots[0]).toMatch(/vague/);
    expect(summary.followUpEmail).toContain('Thank you');
    expect(summary.actionItems).toEqual(['Send follow-up email']);
    expect(summary.generatedAt).toBeGreaterThan(0);
    expect(db.getSession(session.id)?.summary?.summary).toBe('A solid conversation.');
    // Request shape: heavy model, JSON schema with the five fields, transcript in the user turn.
    const req = fake.requests[0]!;
    expect(req.body.model).toBe(DEFAULT_SETTINGS.models.heavy);
    const fmt = (req.body.output_config as { format?: { schema?: { required?: string[] } } })
      ?.format;
    expect(fmt?.schema?.required).toEqual([
      'summary',
      'questions',
      'weakSpots',
      'followUpEmail',
      'actionItems',
    ]);
    const user = JSON.stringify(req.body.messages);
    expect(user).toContain('[00:05] THEM: Tell me about a time you led a migration.');
    expect(user).toContain('AI (suggested');
    expect(typeof req.body.system === 'string' ? req.body.system : '').toContain(
      'Senior Software Engineer at Acme',
    );
  });

  it('refuses to review an empty session with a clear message', async () => {
    const db = new SessionDB(':memory:');
    const s = db.createSession(null, 'live');
    await expect(service(db).generate(s.id)).rejects.toThrow(/no transcript/i);
    await expect(service(db).generate('nope')).rejects.toThrow(/not found/i);
  });

  it('exports Markdown with every section, answers, screenshots and the timestamped transcript', async () => {
    const { db, session } = seed();
    const svc = service(db);
    await svc.generate(session.id);
    const { path } = await svc.export(session.id, 'md');
    expect(path.startsWith(exportsDir)).toBe(true);
    expect(path).toMatch(/kestrel-review-\d{4}-\d{2}-\d{2}-\d{4}-acme-senior-engineer\.md$/);
    expect(existsSync(path)).toBe(true);
    const md = readFileSync(path, 'utf8');
    for (const h of [
      '# Kestrel review — Acme — Senior Engineer',
      '## Summary',
      '## Questions asked',
      '## Weak spots',
      '## Follow-up email',
      '## Action items',
      '## Suggested answers',
      '## Screenshots',
      '## Full transcript',
    ]) {
      expect(md).toContain(h);
    }
    expect(md).toContain('[00:05] THEM: Tell me about a time you led a migration.');
    expect(md).toContain('[00:18] ME: Failures went from twelve percent to one.');
    expect(md).toContain('**At Globex I led the billing migration to Stripe with zero downtime.**');
    expect(md).toContain('- Result: failures down to 1%');
    expect(md).toContain('- [ ] Send follow-up email');
    expect(md).toContain('/tmp/shot_1.png');
  });

  it('exports without a review, noting that none was generated', async () => {
    const { db, session } = seed();
    const { path } = await service(db).export(session.id, 'md');
    const md = readFileSync(path, 'utf8');
    expect(md).toContain('No AI review was generated');
    expect(md).not.toContain('## Summary');
    expect(md).toContain('## Full transcript');
  });

  it('renders the same document to HTML for the PDF path', () => {
    const { db, session } = seed();
    const doc = service(db).document(session.id);
    const html = markdownToHtml(renderMarkdown(doc));
    expect(html).toContain('<h1>Kestrel review');
    expect(html).toContain('<h2>Full transcript</h2>');
    expect(html).toContain('<li>Result: failures down to 1%</li>');
    expect(html).toContain('&lt;'.length ? 'THEM' : '');
    expect(transcriptText(doc.session, doc.utterances, doc.answers).split('\n')).toHaveLength(5); // 4 lines + 1 AI answer
  });
});
