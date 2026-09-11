import type { AppContext } from './context';
import { handle } from './ipc';
import { registerSessionHandlers } from './handlers/session';

/**
 * Boots the feature services (audio, transcription, LLM, extension server, …)
 * and registers their IPC handlers. Each milestone adds its own module here.
 */
export async function bootServices(ctx: AppContext): Promise<void> {
  registerSessionHandlers(ctx);

  // Placeholders replaced by real services in later milestones.
  handle('audio:state', () => ({
    listening: false,
    me: { channel: 'ME', active: false, source: null, deviceLabel: null, error: null, warnings: [] },
    them: { channel: 'THEM', active: false, source: null, deviceLabel: null, error: null, warnings: [] },
    resolvedSystemMode: null,
  }));
  handle('audio:listDevices', () => ({ inputs: [], outputs: [] }));
  handle('transcript:state', () => []);
  handle('extension:state', () => ({
    status: 'off',
    clientName: null,
    inCall: false,
    captionsAvailable: false,
    lastAudioAt: null,
    port: ctx.settings.get().extensionPort,
  }));
  handle('extension:pairing', () => ({ port: ctx.settings.get().extensionPort, token: 'not-ready', url: '' }));
  handle('answer:current', () => []);
  handle('diagnostics:get', () => ({ latency: ctx.db.listLatency(), transcriberStats: [], speculativeRestartRate: 0 }));
  handle('diagnostics:clear', () => ctx.db.clearLatency());
}
