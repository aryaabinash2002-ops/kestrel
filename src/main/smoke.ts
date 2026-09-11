import { app, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { logger } from './logger';

const log = logger.scope('smoke');

/**
 * Developer smoke test: when KESTREL_SMOKE=/path/to/out.png is set, wait for the
 * panel to render, capture it to disk, print renderer console errors, and quit.
 * Optional KESTREL_SMOKE_ROUTE="#/settings/keys" navigates before capturing.
 */
export function attachSmokeTest(panel: BrowserWindow): void {
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
      try {
        const img = await panel.webContents.capturePage();
        writeFileSync(out, img.toPNG());
        log.info('smoke capture written', out);
      } catch (err) {
        log.error('smoke capture failed', err);
      }
      const summary = { errors, route: route ?? null, size: panel.getSize() };
      writeFileSync(out + '.json', JSON.stringify(summary, null, 2));
      console.log('SMOKE_RESULT ' + JSON.stringify(summary));
      app.exit(errors.length ? 2 : 0);
    }, Number(process.env['KESTREL_SMOKE_DELAY'] ?? 2500));
  });
}
