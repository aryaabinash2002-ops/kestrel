import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface RegionInit {
  imageDataUrl: string;
  width: number;
  height: number;
  displayId: number;
}

const api = {
  onInit: (listener: (init: RegionInit) => void) => {
    const fn = (_e: IpcRendererEvent, init: RegionInit) => listener(init);
    ipcRenderer.on('region:init', fn);
    return () => ipcRenderer.off('region:init', fn);
  },
  select: (
    rect: { x: number; y: number; width: number; height: number; displayId: number } | null,
  ) => ipcRenderer.send('region:selected', rect),
};

contextBridge.exposeInMainWorld('kestrelRegion', api);
export type KestrelRegionApi = typeof api;
