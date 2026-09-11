import type { AppContext } from '../context';
import { emit, handle } from '../ipc';

export function registerScreenshotHandlers(ctx: AppContext): void {
  handle('screenshot:solve', async (_e, opts) => {
    try {
      await ctx.screenshots.solve(opts);
    } catch (err) {
      emit('toast', {
        kind: 'error',
        title: 'Screenshot failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
  handle('screenshot:cancel', () => ctx.screenshots.cancel());
  handle('screenshot:list', (_e, sessionId) => ctx.db.listScreenshots(sessionId));
  ctx.hotkeys.on('screenshotSolve', () => {
    void ctx.screenshots.solve({ region: true }).catch((err) => {
      emit('toast', {
        kind: 'error',
        title: 'Screenshot failed',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });
}
