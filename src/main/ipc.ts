import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type {
  IpcEventChannel,
  IpcEventMap,
  IpcInvokeChannel,
  IpcInvokeMap,
  IpcSendChannel,
  IpcSendMap,
} from '@shared/types/ipc';
import { logger } from './logger';

const log = logger.scope('ipc');

type Handler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result'];

/** Typed wrapper over ipcMain.handle. Errors are logged (redacted) and re-thrown to the renderer. */
export function handle<C extends IpcInvokeChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as IpcInvokeMap[C]['args']));
    } catch (err) {
      log.error(`handler ${channel} failed:`, err);
      throw err instanceof Error ? new Error(err.message) : new Error(String(err));
    }
  });
}

/** Typed wrapper over ipcMain.on for fire-and-forget renderer messages. */
export function onSend<C extends IpcSendChannel>(
  channel: C,
  fn: (event: IpcMainEvent, payload: IpcSendMap[C]) => void,
): void {
  ipcMain.on(channel, (event, payload) => fn(event, payload as IpcSendMap[C]));
}

/** Push an event to every open window. */
export function emit<C extends IpcEventChannel>(channel: C, payload: IpcEventMap[C]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/** Push an event to a specific window. */
export function emitTo<C extends IpcEventChannel>(
  win: BrowserWindow | null,
  channel: C,
  payload: IpcEventMap[C],
): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
