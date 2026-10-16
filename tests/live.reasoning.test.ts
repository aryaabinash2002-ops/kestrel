/**
 * Opt-in live check against the real Anthropic API (no Electron, no keychain):
 *   KESTREL_LIVE_KEY=sk-ant-… KESTREL_LIVE_KB=/path/extra-kb.md npx vitest run tests/live.reasoning.test.ts
 * Builds the exact live prompt (profile from the app DB when KESTREL_LIVE_DB is set) and prints answers + timing.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS } from '../src/main/prompts';
import { buildLivePrompt, type ContextProfile } from '../src/main/llm/ContextBuilder';
import { LLMService } from '../src/main/llm/LLMService';
import { parseAnswer } from '../src/main/llm/parseAnswer';

const KEY = process.env['KESTREL_LIVE_KEY'];
const QUESTIONS = (process.env['KESTREL_LIVE_QUESTIONS'] ?? '').split('|').filter(Boolean);

describe.skipIf(!KEY)('live reasoning answers', () => {
  it('answers each question with one final answer', async () => {
    let profile: ContextProfile = {
      userName: 'Arya',
      role: 'End User Support – Associate Services Specialist I',
      company: 'Deloitte',
      type: 'technical',
      language: 'English',
      length: 'short',
      tone: 'confident',
      resumeText: '',
      jdText: '',
      stories: '',
      notes: '',
      knowledge: '',
    };
    if (process.env['KESTREL_LIVE_DB']) {
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(process.env['KESTREL_LIVE_DB'], { readonly: true });
      const row = db.prepare("select * from profiles where id='prof_deloitte_eus'").get() as Record<
        string,
        string
      >;
      profile = {
        ...profile,
        resumeText: row['resume_text']!,
        jdText: row['jd_text']!,
        notes: row['notes']!,
        knowledge: row['knowledge_text']!,
        stories: (JSON.parse(row['stories']!) as { title: string; text: string }[])
          .map((s) => `${s.title}: ${s.text}`)
          .join('\n'),
      };
    }
    if (process.env['KESTREL_LIVE_KB'])
      profile.knowledge += readFileSync(process.env['KESTREL_LIVE_KB'], 'utf8');
    const llm = new LLMService({ get: async () => KEY } as never);
    for (const q of QUESTIONS) {
      const built = buildLivePrompt({
        template: DEFAULT_PROMPTS.live_answer,
        profile,
        model: 'claude-haiku-4-5-20251001',
        utterances: [],
        nowMs: 0,
        summary: null,
        question: q,
      });
      const t0 = Date.now();
      let first = 0;
      const res = await llm.stream({
        model: 'claude-haiku-4-5-20251001',
        system: built.system,
        messages: [{ role: 'user', content: built.user }],
        maxTokens: 170,
        temperature: 0.4,
        fast: true,
        onText: () => undefined,
        onFirstToken: (ts) => (first = ts),
      });
      const p = parseAnswer(res.text);
      const words = (p.headline + ' ' + p.points.join(' ')).split(/\s+/).length;
      const line = `
Q: ${q}\n  ttft ${first - t0} ms | total ${Date.now() - t0} ms | ${words} words | cached ${res.usage.cacheRead}\n  ${p.headline} ${p.points.join(' ')}`;
      console.log(line);
      if (process.env['KESTREL_LIVE_OUT']) appendFileSync(process.env['KESTREL_LIVE_OUT'], line + '\n');
      expect(p.headline.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
