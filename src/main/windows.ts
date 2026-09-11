import { BrowserWindow, screen, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'node:path';
import type { Settings } from '@shared/types/settings';
import { logger } from './logger';

const log = logger.scope('windows');

export class WindowManager {
  panel: BrowserWindow | null = null;
  capture: BrowserWindow | null = null;
  region: BrowserWindow | null = null;
  quitting = false;

  constructor(private getSettings: () => Settings) {}

  private rendererUrl(page: string): { url?: string; file?: string } {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return { url: `${process.env['ELECTRON_RENDERER_URL']}/${page}` };
    }
    return { file: join(__dirname, `../renderer/${page}`) };
  }

  private load(win: BrowserWindow, page: string): void {
    const target = this.rendererUrl(page);
    if (target.url) void win.loadURL(target.url);
    else if (target.file) void win.loadFile(target.file);
  }

  createPanel(): BrowserWindow {
    if (this.panel && !this.panel.isDestroyed()) {
      this.panel.show();
      return this.panel;
    }
    const s = this.getSettings();
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    const width = s.ui.compact ? 380 : 440;
    const height = s.ui.compact ? 520 : 760;
    const win = new BrowserWindow({
      width,
      height,
      minWidth: 340,
      minHeight: 420,
      x: Math.max(0, sw - width - 24),
      y: 48,
      show: false,
      title: 'Kestrel',
      // Always created transparent; the renderer decides how see-through the background is
      // (settings.ui.glass / glassAlpha) so toggling never needs a window recreation.
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      ...(process.platform === 'darwin' && s.ui.glass
        ? { vibrancy: 'hud' as const, visualEffectState: 'active' as const }
        : {}),
      ...(process.platform === 'win32' && s.ui.glass
        ? { backgroundMaterial: 'acrylic' as const }
        : {}),
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 14 },
      ...(process.platform !== 'darwin'
        ? { titleBarOverlay: { color: '#0b0d12', symbolColor: '#e6e8ee', height: 40 } }
        : {}),
      autoHideMenuBar: true,
      opacity: s.ui.opacity,
      alwaysOnTop: s.ui.alwaysOnTop,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        // Throttle timers/animations while hidden (streaming state still arrives over IPC).
        backgroundThrottling: true,
        spellcheck: false,
      },
    });
    if (s.ui.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
    // Stay visible when the user is in a full-screen Zoom/Meet window.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    win.on('ready-to-show', () => win.show());
    win.on('close', (e) => {
      if (process.platform === 'darwin' && !this.quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => {
      if (this.panel === win) this.panel = null;
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    this.load(win, 'index.html');
    this.panel = win;
    log.info('panel created');
    return win;
  }

  createCapture(): BrowserWindow {
    if (this.capture && !this.capture.isDestroyed()) return this.capture;
    // Chromium only services getUserMedia/getDisplayMedia for documents that have been
    // shown, so this window is briefly shown (1×1, transparent, inactive) while streams
    // are acquired — see AudioManager.withCaptureVisible().
    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      opacity: 0,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Kestrel Audio Engine',
      webPreferences: {
        preload: join(__dirname, '../preload/capture.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.on('closed', () => {
      if (this.capture === win) this.capture = null;
    });
    this.load(win, 'capture/index.html');
    this.capture = win;
    log.info('capture window created');
    return win;
  }

  togglePanel(): void {
    const p = this.panel;
    if (!p || p.isDestroyed()) {
      this.createPanel();
      return;
    }
    if (p.isVisible() && p.isFocused()) p.hide();
    else {
      p.show();
      p.focus();
    }
  }

  showPanel(): void {
    const p = this.panel;
    if (!p || p.isDestroyed()) this.createPanel();
    else {
      p.show();
      p.focus();
    }
  }

  applyUi(ui: Settings['ui']): void {
    const p = this.panel;
    if (!p || p.isDestroyed()) return;
    p.setOpacity(ui.opacity);
    p.setAlwaysOnTop(ui.alwaysOnTop, 'floating');
    this.applyGlass(p, ui.glass);
  }

  /** Native blur behind the translucent panel (macOS vibrancy / Windows 11 acrylic). */
  private applyGlass(win: BrowserWindow, glass: boolean): void {
    try {
      if (process.platform === 'darwin') win.setVibrancy(glass ? 'hud' : null);
      else if (process.platform === 'win32') win.setBackgroundMaterial(glass ? 'acrylic' : 'none');
    } catch (err) {
      log.debug('glass effect unavailable', err);
    }
  }

  setCompact(compact: boolean): void {
    const p = this.panel;
    if (!p || p.isDestroyed()) return;
    const [w = 440] = p.getSize();
    const targetW = compact ? Math.min(w, 380) : Math.max(w, 440);
    const targetH = compact ? 520 : 760;
    p.setSize(targetW, targetH, true);
  }

  destroyAll(): void {
    this.quitting = true;
    for (const w of [this.panel, this.capture, this.region]) {
      if (w && !w.isDestroyed()) w.destroy();
    }
  }
}
