import { app, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import type { AppContext } from './context';
import { logger } from './logger';

const log = logger.scope('smoke');

/**
 * Developer smoke test: when KESTREL_SMOKE=/path/to/out.png is set, wait for the
 * panel to render, capture it to disk, print renderer console errors, and quit.
 *   KESTREL_SMOKE_ROUTE="#/settings/keys"  navigate before capturing
 *   KESTREL_SMOKE_AUDIO=1                   start audio capture, sample levels for ~5 s
 *   KESTREL_SMOKE_DELAY=ms                  wait before capturing (default 2500)
 */
export function attachSmokeTest(panel: BrowserWindow, ctx: AppContext): void {
  const out = process.env['KESTREL_SMOKE'];
  if (!out) return;
  if (
    process.env['KESTREL_SMOKE_SEED_PROFILE'] &&
    !ctx.db.listProfiles().some((p) => p.name === 'Acme — Senior Engineer (demo)')
  ) {
    ctx.db.saveProfile({
      name: 'Acme — Senior Engineer (demo)',
      userName: 'Jane',
      role: 'Senior Software Engineer',
      company: 'Acme',
      type: 'behavioral',
      resumeText:
        'Jane Doe — Senior engineer at Globex (2020–2024). Led the billing migration to Stripe with zero downtime, recovering $1.2M annually. Mentored 4 engineers.',
      jdText: 'Acme is hiring a Senior Software Engineer to own the payments platform.',
      stories: [
        {
          id: 'story_demo',
          title: 'Billing migration',
          text: 'Migrated billing to Stripe in one quarter with a phased rollout; failures fell from 12% to 1%.',
        },
      ],
      notes: 'Emphasise ownership and mentoring.',
    });
  }
  // Dev: store API keys from the environment through the app's own SecretStore so the
  // keychain items are owned by this app (no macOS password prompts on later reads).
  for (const [env, key] of [
    ['KESTREL_SMOKE_SET_ANTHROPIC', 'anthropic'],
    ['KESTREL_SMOKE_SET_DEEPGRAM', 'deepgram'],
    ['KESTREL_SMOKE_SET_ASSEMBLYAI', 'assemblyai'],
  ] as const) {
    const v = process.env[env];
    if (v) void ctx.secrets.set(key, v).then(() => log.info(`stored ${key} key from env`));
  }
  if (process.env['KESTREL_SMOKE_SETTINGS']) {
    try {
      ctx.settings.set(JSON.parse(process.env['KESTREL_SMOKE_SETTINGS']));
    } catch (err) {
      log.warn('bad KESTREL_SMOKE_SETTINGS', err);
    }
  }
  const errors: string[] = [];
  panel.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning')
      errors.push(`[${event.level}] ${event.message}`);
  });
  panel.webContents.on('did-finish-load', () => {
    const route = process.env['KESTREL_SMOKE_ROUTE'];
    if (route) void panel.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
    setTimeout(
      async () => {
        const summary: Record<string, unknown> = {
          errors,
          route: route ?? null,
          size: panel.getSize(),
        };
        if (process.env['KESTREL_SMOKE_SESSION']) {
          // Start a live session + capture so the Live screen shows its running state.
          const demo = ctx.db.listProfiles().find((p) => p.name.includes('(demo)'));
          ctx.sessions.start(demo?.id ?? null, 'live');
          await ctx.audio.start().catch((err) => (summary['audioError'] = String(err)));
          ctx.sessions.setListening(true);
          await new Promise((r) =>
            setTimeout(r, Number(process.env['KESTREL_SMOKE_SESSION_MS'] ?? 3000)),
          );
          if (process.env['KESTREL_SMOKE_ANSWER']) {
            // Inject a question from THEM and trigger "Answer now" (needs an LLM endpoint).
            const sid = ctx.sessions.session?.id ?? '';
            const nowMs = ctx.sessions.nowMs();
            ctx.sessions.pushUtterance({
              id: 'smoke_q',
              sessionId: sid,
              speaker: 'THEM',
              text: 'Can you tell me about a time you led a difficult migration?',
              startMs: nowMs - 3000,
              endMs: nowMs - 200,
              isFinal: true,
              source: 'stt',
            });
            await new Promise((r) => setTimeout(r, Number(process.env['KESTREL_SMOKE_ANSWER_WAIT_MS'] ?? 0)));
            ctx.answers.answerNow();
            await new Promise((r) => setTimeout(r, Number(process.env['KESTREL_SMOKE_ANSWER_MS'] ?? 4000)));
            summary['cards'] = ctx.answers.current();
          }
          if (process.env['KESTREL_SMOKE_CHAT']) {
            ctx.answers.chat('Give me a shorter version with one number.');
            await new Promise((r) => setTimeout(r, 2500));
            summary['chat'] = ctx.answers.current().filter((c) => c.kind === 'chat');
          }
          if (process.env['KESTREL_SMOKE_SCREENSHOT']) {
            try {
              await ctx.screenshots.solve({ region: false });
              await new Promise((r) => setTimeout(r, Number(process.env['KESTREL_SMOKE_SCREENSHOT_MS'] ?? 2500)));
              summary['screenshots'] = ctx.sessions.session
                ? ctx.db.listScreenshots(ctx.sessions.session.id)
                : [];
            } catch (err) {
              summary['screenshotError'] = String(err);
            }
          }
          summary['session'] = {
            transcription: ctx.transcription.states(),
            audio: ctx.audio.state(),
            utterances: ctx.sessions.finals().length,
            transcript: ctx.sessions.finals().map((u) => ({ speaker: u.speaker, text: u.text, startMs: u.startMs, endMs: u.endMs })),
          };
          if (process.env['KESTREL_SMOKE_KEEP_SESSION'] !== '1') {
            const endedId = ctx.sessions.session?.id ?? null;
            await ctx.audio.stop();
            ctx.sessions.stop();
            if (process.env['KESTREL_SMOKE_REVIEW'] && endedId) {
              try {
                const t0 = Date.now();
                const review = await ctx.review.generate(endedId);
                const exported = await ctx.review.export(endedId, 'md');
                summary['review'] = { ms: Date.now() - t0, review, exported };
              } catch (err) {
                summary['reviewError'] = String(err);
              }
            }
          }
          if (process.env['KESTREL_SMOKE_PRACTICE']) {
            try {
              const st = await ctx.practice.start({ profileId: null, setId: 'behavioral', count: 1, useTts: false });
              const sid = st.session?.id ?? '';
              await new Promise((r) => setTimeout(r, 800));
              const t0 = Date.now();
              await ctx.practice.submit(
                'Sure. I am a senior engineer with seven years in payments. At Globex I led the billing migration to Stripe: we phased the rollout over one quarter, ran dual writes, and cut payment failures from twelve percent to one percent, recovering about 1.2 million dollars a year.',
              );
              for (let i = 0; i < 60 && ctx.db.listPracticeScores(sid).length === 0; i++) await new Promise((r) => setTimeout(r, 250));
              summary['practice'] = { ms: Date.now() - t0, scores: ctx.db.listPracticeScores(sid) };
              await ctx.practice.stop();
            } catch (err) {
              summary['practiceError'] = String(err);
            }
          }
        }
        if (process.env['KESTREL_SMOKE_AUDIO']) {
          const captureLogs: string[] = [];
          ctx.windows.capture?.webContents.on('console-message', (ev) =>
            captureLogs.push(`[${ev.level}] ${ev.message}`),
          );
          try {
            const { systemPreferences } = await import('electron');
            summary['permissions'] =
              process.platform === 'darwin'
                ? {
                    mic: systemPreferences.getMediaAccessStatus('microphone'),
                    screen: systemPreferences.getMediaAccessStatus('screen'),
                  }
                : 'n/a';
            const peaks: Record<string, number> = { ME: 0, THEM: 0 };
            const { ipcMain } = await import('electron');
            ipcMain.on(
              'capture:event',
              (_e, ev: { type: string; channel?: string; level?: number }) => {
                if (ev.type === 'level' && ev.channel && typeof ev.level === 'number') {
                  peaks[ev.channel] = Math.max(peaks[ev.channel] ?? 0, ev.level);
                }
              },
            );
            let chunks = 0;
            ctx.audio.on('pcm', () => chunks++);
            const started = await ctx.audio.start();
            await new Promise((r) => setTimeout(r, 5000));
            summary['audio'] = { started, peaks, pcmChunks: chunks, after: ctx.audio.state() };
            summary['captureLog'] = await ctx.windows.capture?.webContents.executeJavaScript(
              `document.getElementById("log")?.textContent`,
            );
            summary['captureConsole'] = captureLogs;
            await ctx.audio.stop();
          } catch (err) {
            summary['audioError'] = String(err);
          }
        }
        try {
          const img = await panel.webContents.capturePage();
          writeFileSync(out, img.toPNG());
          log.info('smoke capture written', out);
        } catch (err) {
          log.error('smoke capture failed', err);
        }
        writeFileSync(out + '.json', JSON.stringify(summary, null, 2));
        console.log('SMOKE_RESULT ' + JSON.stringify(summary));
        app.exit(errors.length ? 2 : 0);
      },
      Number(process.env['KESTREL_SMOKE_DELAY'] ?? 2500),
    );
  });
}
