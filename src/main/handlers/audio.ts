import type { AppContext } from '../context';
import { emit, handle } from '../ipc';

export function registerAudioHandlers(ctx: AppContext): void {
  const audio = ctx.audio;
  handle('audio:listDevices', () => audio.listDevices());
  handle('audio:state', () => audio.state());
  handle('audio:start', async () => {
    const st = await audio.start();
    ctx.sessions.setListening(st.listening);
    return st;
  });
  handle('audio:stop', async () => {
    const st = await audio.stop();
    ctx.sessions.setListening(false);
    return st;
  });
  handle('audio:test', (_e, channel) => audio.test(channel));

  ctx.hotkeys.on('toggleListening', () => {
    if (audio.state().listening) {
      void audio.stop().then(() => ctx.sessions.setListening(false));
      return;
    }
    if (!ctx.sessions.session) {
      // No session yet: bring up the panel with the start dialog (profile + consent) instead of
      // silently capturing audio.
      ctx.windows.showPanel();
      emit('navigate', { to: '/live?start=1' });
      return;
    }
    void audio.start().then((s) => ctx.sessions.setListening(s.listening));
  });
  ctx.hotkeys.on('togglePanel', () => ctx.windows.togglePanel());

  // Restart capture when device settings change while listening.
  ctx.settings.onChange((next, prev) => {
    if (!audio.state().listening) return;
    if (JSON.stringify(next.audio) !== JSON.stringify(prev.audio)) {
      void audio.stop().then(() => audio.start());
    }
  });
}
