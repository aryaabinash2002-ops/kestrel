import type { AppContext } from './context';
import { handle } from './ipc';
import { registerSessionHandlers } from './handlers/session';
import { registerAudioHandlers } from './handlers/audio';
import { registerTranscriptionHandlers } from './handlers/transcription';
import { registerExtensionHandlers } from './handlers/extension';
import { registerAnswerHandlers } from './handlers/answers';

/**
 * Boots the feature services (audio, transcription, LLM, extension server, …)
 * and registers their IPC handlers. Each milestone adds its own module here.
 */
export async function bootServices(ctx: AppContext): Promise<void> {
  registerSessionHandlers(ctx);
  registerAudioHandlers(ctx);
  registerTranscriptionHandlers(ctx);
  registerExtensionHandlers(ctx);
  registerAnswerHandlers(ctx);
  await ctx.extension.start();

  // Placeholders replaced by real services in later milestones.
  handle('diagnostics:get', () => ({ latency: ctx.db.listLatency(), transcriberStats: ctx.transcription.statsSnapshot(), speculativeRestartRate: ctx.answers.speculativeStarts ? ctx.answers.restarts / ctx.answers.speculativeStarts : 0, cache: ctx.answers.cacheStatus() }));
  handle('diagnostics:clear', () => ctx.db.clearLatency());
}
