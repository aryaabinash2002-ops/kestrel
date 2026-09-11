import type { AppContext } from './context';
import { handle } from './ipc';
import { registerSessionHandlers } from './handlers/session';
import { registerAudioHandlers } from './handlers/audio';
import { registerTranscriptionHandlers } from './handlers/transcription';
import { registerExtensionHandlers } from './handlers/extension';

/**
 * Boots the feature services (audio, transcription, LLM, extension server, …)
 * and registers their IPC handlers. Each milestone adds its own module here.
 */
export async function bootServices(ctx: AppContext): Promise<void> {
  registerSessionHandlers(ctx);
  registerAudioHandlers(ctx);
  registerTranscriptionHandlers(ctx);
  registerExtensionHandlers(ctx);
  await ctx.extension.start();

  // Placeholders replaced by real services in later milestones.
  handle('answer:current', () => []);
  handle('diagnostics:get', () => ({ latency: ctx.db.listLatency(), transcriberStats: ctx.transcription.statsSnapshot(), speculativeRestartRate: 0 }));
  handle('diagnostics:clear', () => ctx.db.clearLatency());
}
