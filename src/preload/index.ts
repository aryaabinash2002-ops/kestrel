import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { KestrelApi } from '@shared/types/ipc';

const CHANNEL_RE = /^[a-z]+:[A-Za-z]+$|^hotkey$|^toast$|^navigate$/;

function assertChannel(channel: string): void {
  if (!CHANNEL_RE.test(channel)) throw new Error(`Invalid IPC channel: ${channel}`);
}

const api: KestrelApi = {
  invoke: (channel, ...args) => {
    assertChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, listener) => {
    assertChannel(channel);
    const fn = (_e: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.off(channel, fn);
  },
  send: (channel, payload) => {
    assertChannel(channel);
    ipcRenderer.send(channel, payload);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('kestrel', api);
