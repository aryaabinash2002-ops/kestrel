import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context';
import { emit, handle } from '../ipc';
import { logger } from '../logger';

const log = logger.scope('extension');

const SELF_NAMES = new Set(['you', 'tú', 'vous', 'du', 'você', 'あなた', 'आप', 'me']);

export function extensionFolder(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'extension');
  const dist = join(app.getAppPath(), 'extension', 'dist');
  return existsSync(dist) ? dist : join(app.getAppPath(), 'extension');
}

export function registerExtensionHandlers(ctx: AppContext): void {
  const bridge = ctx.extension;

  handle('extension:pairing', () => bridge.pairing());
  handle('extension:state', () => bridge.state());
  handle('extension:regenerateToken', () => {
    bridge.regenerateToken();
    return bridge.pairing();
  });
  handle('extension:openFolder', async () => {
    const dir = extensionFolder();
    await shell.openPath(dir);
    return dir;
  });

  // ----- audio from the Meet tab → THEM channel -----
  bridge.on('audio', (pcm: Buffer, ts: number) => ctx.audio.ingestExternal('THEM', pcm, ts));
  bridge.on('capture', (started: boolean) => ctx.audio.setExtensionCapturing(started));

  // ----- call lifecycle -----
  bridge.on('call', async (state: 'joined' | 'left', url: string) => {
    const settings = ctx.settings.get();
    if (state === 'joined') {
      log.info('Meet call joined', url);
      if (!settings.autoStartOnMeetJoin) return;
      if (!ctx.sessions.session) {
        ctx.sessions.start(settings.lastProfileId, 'live');
        emit('navigate', { to: '/live' });
      }
      if (!ctx.audio.state().listening) {
        await ctx.audio.start();
        ctx.sessions.setListening(true);
      }
      emit('toast', { kind: 'info', title: 'Google Meet call detected', message: 'Kestrel is listening.' });
    } else {
      log.info('Meet call left');
      const s = ctx.sessions.session;
      if (!s) return;
      if (ctx.audio.state().listening) await ctx.audio.stop();
      ctx.sessions.stop();
      emit('navigate', { to: `/review/${s.id}` });
      emit('toast', { kind: 'info', title: 'Call ended', message: 'Session saved — opening the review.' });
    }
  });

  // ----- captions: backup transcript + speaker names -----
  bridge.on('caption', (c: { speaker: string; text: string; ts: number; isFinal: boolean }) => {
    if (!ctx.sessions.session) return;
    const isSelf = SELF_NAMES.has(c.speaker.trim().toLowerCase());
    const channel = isSelf ? 'ME' : 'THEM';
    const stt = ctx.transcription.states().find((s) => s.channel === channel);
    const sttHealthy = stt?.status === 'open';
    if (!isSelf) ctx.transcription.setSpeakerHint(c.speaker, c.ts);
    if (!sttHealthy) {
      // Provider down / no key: captions become the transcript.
      ctx.transcription.pushExternalUtterance(channel, c.text, isSelf ? undefined : c.speaker, c.isFinal);
    }
  });

  ctx.sessions.on('started', () => bridge.notifySession(true));
  ctx.sessions.on('ended', () => bridge.notifySession(false));
  ctx.settings.onChange((next, prev) => {
    if (next.extensionPort !== prev.extensionPort) {
      emit('toast', { kind: 'info', title: 'Extension port changed', message: 'Restart Kestrel to apply.' });
    }
  });
}
