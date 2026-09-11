import type { AppContext } from '../context';
import { handle } from '../ipc';

export function registerReviewHandlers(ctx: AppContext): void {
  handle('review:generate', (_e, sessionId) => ctx.review.generate(sessionId));
  handle('review:export', (_e, sessionId, format) => ctx.review.export(sessionId, format));
}
