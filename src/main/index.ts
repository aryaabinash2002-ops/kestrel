import { app, BrowserWindow, desktopCapturer, session } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';
import { Paths } from './paths';
import { SettingsStore } from './settings';
import { SecretStore } from './secrets';
import { SessionDB } from './db';
import { WindowManager } from './windows';
import { HotkeyManager } from './hotkeys';
import type { AppContext } from './context';
import { registerCoreHandlers } from './handlers/core';
import { emit } from './ipc';
import { bootServices } from "./services";
import { attachSmokeTest } from "./smoke";
import { SessionManager } from "./session/SessionManager";
import { AudioManager } from "./audio/AudioManager";
import { TranscriptionService } from "./transcription/TranscriptionService";
import { ExtensionBridge } from "./extension/ExtensionBridge";
import { LLMService } from "./llm/LLMService";
import { AnswerEngine } from "./llm/AnswerEngine";
import { AutoAnswer } from "./llm/AutoAnswer";
import { Classifier } from "./llm/Classifier";
import { ScreenshotService } from "./screenshot/ScreenshotService";
import { ReviewService } from "./review/ReviewService";
import { PracticeService } from "./practice/PracticeService";

const log = logger.scope('main');

// Developer switch: run several isolated instances (smoke tests) side by side.
if (process.env['KESTREL_USER_DATA']) app.setPath('userData', process.env['KESTREL_USER_DATA']);

// Single instance: a second launch just focuses the panel.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => ctx?.windows.showPanel());
}

let ctx: AppContext | null = null;

function readSettingsDataDir(settingsFile: string): string | null {
  try {
    if (!existsSync(settingsFile)) return null;
    const raw = JSON.parse(readFileSync(settingsFile, 'utf8')) as { dataDir?: string | null };
    return raw.dataDir ?? null;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  electronApp.setAppUserModelId('app.kestrel.copilot');
  app.setName('Kestrel');

  const bootstrapPaths = new Paths(null);
  const paths = new Paths(readSettingsDataDir(bootstrapPaths.settingsFile));
  paths.ensure();
  logger.init(paths.logsDir, { minLevel: is.dev ? 'debug' : 'info', consoleLevel: is.dev ? 'debug' : 'warn' });
  log.info(`Kestrel ${app.getVersion()} starting (electron ${process.versions.electron}, ${process.platform} ${process.arch})`);

  const settings = new SettingsStore(paths.settingsFile);
  const secrets = new SecretStore(paths.secretsFile);
  await secrets.init();
  const db = new SessionDB(paths.dbFile);
  const windows = new WindowManager(() => settings.get());
  const hotkeys = new HotkeyManager();
  const sessions = new SessionManager(db);
  const audio = new AudioManager(() => windows.capture, () => settings.get());
  const transcription = new TranscriptionService(sessions, audio, secrets, () => settings.get());
  const extension = new ExtensionBridge({
    getPort: () => settings.get().extensionPort,
    getToken: () => db.getMeta('extension_token'),
    setToken: (t) => db.setMeta('extension_token', t),
    appVersion: app.getVersion(),
    isSessionActive: () => !!sessions.session,
  });
  const llm = new LLMService(secrets);
  const answers = new AnswerEngine({ llm, sessions, db, getSettings: () => settings.get() });
  const auto = new AutoAnswer(transcription, sessions, answers, new Classifier(llm, () => settings.get()), () => settings.get());
  const screenshots = new ScreenshotService({ llm, sessions, db, windows, paths, getSettings: () => settings.get() });
  const review = new ReviewService({ llm, db, paths, windows, getSettings: () => settings.get() });
  const practice = new PracticeService({ llm, db, sessions, audio, transcription, getSettings: () => settings.get() });

  ctx = {
    paths,
    settings,
    secrets,
    db,
    windows,
    hotkeys,
    sessions,
    audio,
    transcription,
    extension,
    llm,
    answers,
    auto,
    screenshots,
    review,
    practice,
    isDev: is.dev,
    version: app.getVersion(),
  };

  // Media permissions: only our own windows ask, and only for mic / display capture.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'display-capture', 'audioCapture', 'mediaKeySystem'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'display-capture', 'audioCapture'].includes(permission),
  );

  // System-audio loopback for the THEM channel. The capture renderer calls
  // getDisplayMedia({ audio: true, video: true }) and immediately drops the video track.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const first = sources[0];
          if (!first) {
            log.warn('no screen sources for loopback');
            callback({});
            return;
          }
          callback({ video: first, audio: 'loopback' });
        })
        .catch((err) => {
          log.error('display media handler failed', err);
          callback({});
        });
    },
    { useSystemPicker: false },
  );

  app.on('browser-window-created', (_e, window) => optimizer.watchWindowShortcuts(window));

  registerCoreHandlers(ctx);
  await bootServices(ctx);

  windows.createCapture();
  attachSmokeTest(windows.createPanel(), ctx);

  const failed = hotkeys.apply(settings.get().hotkeys);
  if (failed.length) {
    setTimeout(
      () =>
        emit('toast', {
          kind: 'warning',
          title: 'Some hotkeys could not be registered',
          message: failed.join(', ') + ' — change them in Settings → Hotkeys.',
        }),
      2500,
    );
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createPanel();
    else windows.showPanel();
  });
}

process.on('uncaughtException', (err) => {
  log.error('uncaught exception', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason);
});

app.whenReady().then(boot).catch((err) => {
  log.error('boot failed', err);
  console.error(err);
});

app.on('before-quit', () => {
  if (ctx) ctx.windows.quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    void ctx?.extension.stop();
    ctx?.db.close();
  } catch {
    /* ignore */
  }
});

export function getContext(): AppContext | null {
  return ctx;
}

export const resourcesDir = (): string => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'));
