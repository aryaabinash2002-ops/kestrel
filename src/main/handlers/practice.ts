import type { AppContext } from '../context';
import { handle } from '../ipc';

export function registerPracticeHandlers(ctx: AppContext): void {
  const p = ctx.practice;
  handle('practice:sets', (_e, profileId) => p.sets(profileId));
  handle('practice:start', (_e, opts) => p.start(opts));
  handle('practice:submit', (_e, text) => p.submit(text));
  handle('practice:skip', () => p.skip());
  handle('practice:stop', () => p.stop());
  handle('practice:history', (_e, profileId) => p.history(profileId));
  handle('practice:speak', () => undefined); // TTS happens in the renderer (Web Speech API)
}
