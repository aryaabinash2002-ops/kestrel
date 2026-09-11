import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { KestrelCaptureApi } from '@shared/types/ipc';
import type { CaptureRequest } from '@shared/types/audio';

const api: KestrelCaptureApi = {
  onRequest: (listener) => {
    const fn = (_e: IpcRendererEvent, req: CaptureRequest) => listener(req);
    ipcRenderer.on('capture:request', fn);
    return () => ipcRenderer.off('capture:request', fn);
  },
  reply: (reply) => ipcRenderer.send('capture:reply', reply),
  event: (ev) => ipcRenderer.send('capture:event', ev),
  pcm: (channel, ts, pcm) => ipcRenderer.send('capture:pcm', { channel, ts, pcm }),
};

contextBridge.exposeInMainWorld('kestrelCapture', api);
