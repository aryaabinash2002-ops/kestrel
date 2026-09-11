import { app, dialog, shell, systemPreferences } from 'electron';
import { rmSync, existsSync } from 'node:fs';
import { release } from 'node:os';
import type { AppContext } from '../context';
import { handle, emit } from '../ipc';
import { logger } from '../logger';
import { DEFAULT_PROMPTS } from '../prompts';
import type { PermissionStatus } from '@shared/types/ipc';

const log = logger.scope('core');

function macOSVersion(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    // Darwin major 25 => macOS 26, 24 => 15, 23 => 14 ...
    const major = parseInt(release().split('.')[0] ?? '0', 10);
    return major >= 25 ? String(major + 1) : String(major - 9);
  } catch {
    return null;
  }
}

export function registerCoreHandlers(ctx: AppContext): void {
  handle('app:info', () => ({
    version: ctx.version,
    platform: process.platform,
    arch: process.arch,
    userDataPath: ctx.paths.userData,
    dataDir: ctx.paths.dataDir,
    isDev: ctx.isDev,
    electron: process.versions.electron ?? '',
    macOSVersion: macOSVersion(),
  }));

  handle('app:openExternal', async (_e, url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs can be opened');
    await shell.openExternal(url);
  });

  handle('app:openPath', async (_e, p) => {
    await shell.openPath(p);
  });

  handle('app:permissions', (): PermissionStatus => {
    if (process.platform !== 'darwin') return { microphone: 'granted', screen: 'granted' };
    return {
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      screen: systemPreferences.getMediaAccessStatus('screen'),
    };
  });

  handle('app:requestMicPermission', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  handle('app:openPrivacySettings', async (_e, pane) => {
    if (process.platform === 'darwin') {
      const map = {
        microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        audio: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
      };
      await shell.openExternal(map[pane]);
    } else if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone');
    }
  });

  handle('app:chooseDataDir', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    ctx.settings.set({ dataDir: dir });
    emit('toast', { kind: 'info', title: 'Data folder changed', message: 'Restart Kestrel to use the new folder.' });
    return dir;
  });

  handle('app:deleteAllData', async () => {
    log.warn('deleting all data');
    ctx.db.wipe();
    for (const dir of [ctx.paths.filesDir, ctx.paths.exportsDir]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    ctx.paths.ensure();
    await ctx.secrets.clearAll();
    emit('toast', { kind: 'success', title: 'All data deleted' });
  });

  handle('app:hotkeyTrigger', (_e, name) => {
    emit('hotkey', { name });
  });

  // ----- settings -----
  handle('settings:get', () => ctx.settings.get());
  handle('settings:set', (_e, patch) => ctx.settings.set(patch));
  handle('settings:resetPrompt', (_e, name) => {
    const prompts = { ...ctx.settings.get().prompts };
    delete prompts[name];
    return ctx.settings.set({ prompts });
  });
  handle('settings:defaultPrompt', (_e, name) => DEFAULT_PROMPTS[name]);

  // ----- secrets -----
  handle('secrets:set', (_e, key, value) => ctx.secrets.set(key, value));
  handle('secrets:delete', (_e, key) => ctx.secrets.delete(key));
  handle('secrets:status', () => ctx.secrets.status());
  handle('secrets:backend', () => ctx.secrets.getBackend());

  // ----- window -----
  handle('window:setAlwaysOnTop', (_e, flag) => {
    ctx.settings.set({ ui: { alwaysOnTop: flag } });
  });
  handle('window:setOpacity', (_e, opacity) => {
    ctx.settings.set({ ui: { opacity } });
  });
  handle('window:minimize', () => ctx.windows.panel?.minimize());
  handle('window:close', () => ctx.windows.panel?.close());
  handle('window:setCompact', (_e, compact) => {
    ctx.settings.set({ ui: { compact } });
    ctx.windows.setCompact(compact);
  });
  handle('window:togglePanel', () => ctx.windows.togglePanel());

  ctx.settings.onChange((next, prev) => {
    emit('settings:changed', next);
    if (JSON.stringify(next.ui) !== JSON.stringify(prev.ui)) ctx.windows.applyUi(next.ui);
    if (JSON.stringify(next.hotkeys) !== JSON.stringify(prev.hotkeys)) {
      const failed = ctx.hotkeys.apply(next.hotkeys);
      if (failed.length) {
        emit('toast', {
          kind: 'warning',
          title: 'Some hotkeys could not be registered',
          message: failed.join(', ') + ' — they may be taken by another app.',
        });
      }
    }
  });

  app.on('will-quit', () => ctx.hotkeys.unregisterAll());
}
