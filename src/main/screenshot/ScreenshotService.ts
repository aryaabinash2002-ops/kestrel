import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  type NativeImage,
  type Rectangle,
} from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import type { ScreenshotResult } from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import { uid } from '@shared/utils';
import type { SessionDB } from '../db';
import type { LLMService } from '../llm/LLMService';
import type { SessionManager } from '../session/SessionManager';
import type { WindowManager } from '../windows';
import type { Paths } from '../paths';
import { emit } from '../ipc';
import { logger } from '../logger';
import { DEFAULT_PROMPTS, renderTemplate } from '../prompts';

const log = logger.scope('screenshot');
/** Longest edge sent to the model (keeps image tokens ≈ 1.5 k). */
const MODEL_MAX_EDGE = 1600;

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: number;
}

export interface ScreenshotDeps {
  llm: LLMService;
  sessions: SessionManager;
  db: SessionDB;
  windows: WindowManager;
  paths: Paths;
  getSettings: () => Settings;
}

/**
 * "Solve what's on screen": capture the display under the cursor (optionally a dragged
 * region), store the PNG, and stream the strong model's answer.
 */
export class ScreenshotService {
  private active: { id: string; controller: AbortController } | null = null;
  private overlay: BrowserWindow | null = null;

  constructor(private deps: ScreenshotDeps) {}

  cancel(): void {
    this.active?.controller.abort();
    this.active = null;
    this.closeOverlay(null);
  }

  async solve(opts: { region: boolean }): Promise<void> {
    if (this.overlay) return; // selection already in progress
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const panel = this.deps.windows.panel;
    // Don't capture ourselves: hide the panel for the capture, then restore it.
    const panelWasVisible = !!panel && !panel.isDestroyed() && panel.isVisible();
    if (panelWasVisible) panel!.hide();
    let image: NativeImage;
    try {
      await new Promise((r) => setTimeout(r, 120)); // let the window fade out
      image = await this.captureDisplay(display.id, display.size, display.scaleFactor);
    } finally {
      if (panelWasVisible) panel!.showInactive();
    }
    let crop: Rectangle | null = null;
    if (opts.region) {
      const region = await this.selectRegion(display.bounds, display.id, image);
      if (!region) return;
      const s = display.scaleFactor;
      crop = {
        x: Math.round(region.x * s),
        y: Math.round(region.y * s),
        width: Math.round(region.width * s),
        height: Math.round(region.height * s),
      };
    }
    const final = crop ? image.crop(crop) : image;
    await this.run(final);
  }

  private async captureDisplay(
    displayId: number,
    size: { width: number; height: number },
    scale: number,
  ): Promise<NativeImage> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      },
    });
    const src = sources.find((s) => s.display_id === String(displayId)) ?? sources[0];
    if (!src) throw new Error('No screen source available (check Screen Recording permission)');
    if (src.thumbnail.isEmpty())
      throw new Error(
        'Screen capture returned an empty image — grant Screen Recording permission and restart Kestrel',
      );
    return src.thumbnail;
  }

  private selectRegion(
    bounds: Rectangle,
    displayId: number,
    image: NativeImage,
  ): Promise<Region | null> {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        fullscreenable: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        webPreferences: {
          preload: join(__dirname, '../preload/region.js'),
          contextIsolation: true,
          sandbox: false,
        },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlay = win;
      const done = (r: Region | null) => {
        ipcMain.removeListener('region:selected', onSelected);
        this.closeOverlay(win);
        resolve(r);
      };
      const onSelected = (_e: unknown, rect: Region | null) => done(rect);
      ipcMain.on('region:selected', onSelected);
      win.on('closed', () => {
        if (this.overlay === win) done(null);
      });
      win.webContents.once('did-finish-load', () => {
        // JPEG keeps the overlay background small on Retina displays.
        const preview = image.resize({ width: bounds.width * 2 });
        win.webContents.send('region:init', {
          imageDataUrl: `data:image/jpeg;base64,${preview.toJPEG(72).toString('base64')}`,
          width: bounds.width,
          height: bounds.height,
          displayId,
        });
        win.show();
        win.focus();
      });
      if (is.dev && process.env['ELECTRON_RENDERER_URL'])
        void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/region/index.html`);
      else void win.loadFile(join(__dirname, '../renderer/region/index.html'));
    });
  }

  private closeOverlay(win: BrowserWindow | null): void {
    const w = win ?? this.overlay;
    if (this.overlay === w) this.overlay = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  private async run(image: NativeImage): Promise<void> {
    const settings = this.deps.getSettings();
    const session = this.deps.sessions.session;
    const id = uid('shot');
    const path = join(this.deps.paths.screenshotsDir, `${id}.png`);
    writeFileSync(path, image.toPNG());
    const result: ScreenshotResult = {
      id,
      sessionId: session?.id ?? null,
      path,
      result: '',
      status: 'streaming',
      createdAt: Date.now(),
    };
    this.deps.db.saveScreenshot(result);
    emit('screenshot:event', { type: 'start', result });
    this.deps.windows.showPanel();

    const { width, height } = image.getSize();
    const scale = Math.min(1, MODEL_MAX_EDGE / Math.max(width, height));
    const forModel =
      scale < 1
        ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
        : image;
    const b64 = forModel.toPNG().toString('base64');

    const profile = this.deps.sessions.activeProfile;
    const system = renderTemplate(
      settings.prompts.screenshot_solve ?? DEFAULT_PROMPTS.screenshot_solve,
      {
        user_name: profile?.userName || 'the user',
        preferred_language: settings.defaults.codeLanguage,
        language: profile?.language || settings.defaults.language,
      },
    );
    const recentThem = this.deps.sessions
      .recent(90_000, 'THEM')
      .map((u) => u.text)
      .join(' ');
    const controller = new AbortController();
    this.active?.controller.abort();
    this.active = { id, controller };
    try {
      const res = await this.deps.llm.stream({
        model: settings.models.heavy,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
              {
                type: 'text',
                text:
                  'Solve what is on this screen.' +
                  (recentThem
                    ? `\n\nWhat the other party said most recently (may describe the task): "${recentThem.slice(-600)}"`
                    : ''),
              },
            ],
          },
        ],
        maxTokens: 2500,
        think: true,
        signal: controller.signal,
        onText: (delta) => emit('screenshot:event', { type: 'delta', id, text: delta }),
      });
      result.result = res.text;
      result.status = 'done';
      this.deps.db.saveScreenshot(result);
      emit('screenshot:event', { type: 'done', id, result });
      log.info(`screenshot ${id} solved (${res.usage.output} tokens)`);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      result.status = 'error';
      emit('screenshot:event', { type: 'error', id, error: message });
      log.warn('screenshot solve failed', message);
    } finally {
      if (this.active?.id === id) this.active = null;
    }
  }
}
