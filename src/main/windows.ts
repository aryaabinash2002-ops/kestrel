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
      backgroundColor: s.ui.theme === 'light' ? '#f7f7f8' : '#0b0d12',
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
        backgroundThrottling: false,
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
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
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
