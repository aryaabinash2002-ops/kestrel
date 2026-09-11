import { app, shell } from 'electron';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context';
import { emit, handle } from '../ipc';
import { logger } from '../logger';

const log = logger.scope('extension');

const SELF_NAMES = new Set(['you', 'tú', 'vous', 'du', 'você', 'あなた', 'आप', 'me']);

/** Source of the bundled extension (inside the app bundle when packaged). */
function bundledExtensionFolder(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'extension');
  const dist = join(app.getAppPath(), 'extension', 'dist');
  return existsSync(dist) ? dist : join(app.getAppPath(), 'extension');
}

/**
 * Folder to point Chrome's "Load unpacked" at. The macOS file picker cannot browse into an
 * .app bundle, so the bundled extension is copied to a plain folder in the user-data dir
 * (refreshed whenever the bundled copy is newer).
 */
export function extensionFolder(userData: string): string {
  const src = bundledExtensionFolder();
  const dest = join(userData, 'extension');
  try {
    const srcManifest = join(src, 'manifest.json');
    const destManifest = join(dest, 'manifest.json');
    const stale =
      !existsSync(destManifest) || statSync(srcManifest).mtimeMs > statSync(destManifest).mtimeMs;
    if (stale) {
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    }
    return dest;
  } catch (err) {
    log.warn('could not stage the extension folder', err);
    return src;
  }
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
    const dir = extensionFolder(ctx.paths.userData);
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
      emit('toast', {
        kind: 'info',
        title: 'Google Meet call detected',
        message: 'Kestrel is listening.',
      });
    } else {
      log.info('Meet call left');
      const s = ctx.sessions.session;
      if (!s) return;
      if (ctx.audio.state().listening) await ctx.audio.stop();
      ctx.sessions.stop();
      emit('navigate', { to: `/review/${s.id}` });
      emit('toast', {
        kind: 'info',
        title: 'Call ended',
        message: 'Session saved — opening the review.',
      });
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
      ctx.transcription.pushExternalUtterance(
        channel,
        c.text,
        isSelf ? undefined : c.speaker,
        c.isFinal,
      );
    }
  });

  ctx.sessions.on('started', () => bridge.notifySession(true));
  ctx.sessions.on('ended', () => bridge.notifySession(false));
  ctx.settings.onChange((next, prev) => {
    if (next.extensionPort !== prev.extensionPort) {
      emit('toast', {
        kind: 'info',
        title: 'Extension port changed',
        message: 'Restart Kestrel to apply.',
      });
    }
  });
}
