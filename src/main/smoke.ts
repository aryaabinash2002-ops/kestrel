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
  const errors: string[] = [];
  panel.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') errors.push(`[${event.level}] ${event.message}`);
  });
  panel.webContents.on('did-finish-load', () => {
    const route = process.env['KESTREL_SMOKE_ROUTE'];
    if (route) void panel.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
    setTimeout(async () => {
      const summary: Record<string, unknown> = { errors, route: route ?? null, size: panel.getSize() };
      if (process.env["KESTREL_SMOKE_AUDIO"]) {
        const captureLogs: string[] = [];
        ctx.windows.capture?.webContents.on("console-message", (ev) => captureLogs.push(`[${ev.level}] ${ev.message}`));
        try {
          const { systemPreferences } = await import("electron");
          summary["permissions"] = process.platform === "darwin" ? { mic: systemPreferences.getMediaAccessStatus("microphone"), screen: systemPreferences.getMediaAccessStatus("screen") } : "n/a";
          const peaks: Record<string, number> = { ME: 0, THEM: 0 };
          const { ipcMain } = await import('electron');
          ipcMain.on('capture:event', (_e, ev: { type: string; channel?: string; level?: number }) => {
            if (ev.type === 'level' && ev.channel && typeof ev.level === 'number') {
              peaks[ev.channel] = Math.max(peaks[ev.channel] ?? 0, ev.level);
            }
          });
          let chunks = 0;
          ctx.audio.on('pcm', () => chunks++);
          const started = await ctx.audio.start();
          await new Promise((r) => setTimeout(r, 5000));
          summary["audio"] = { started, peaks, pcmChunks: chunks, after: ctx.audio.state() };
          summary["captureLog"] = await ctx.windows.capture?.webContents.executeJavaScript(`document.getElementById("log")?.textContent`);
          summary["captureConsole"] = captureLogs;
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
    }, Number(process.env['KESTREL_SMOKE_DELAY'] ?? 2500));
  });
}
