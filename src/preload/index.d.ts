import type { KestrelApi, KestrelCaptureApi } from '@shared/types/ipc';

declare global {
  interface Window {
    kestrel: KestrelApi;
    kestrelCapture: KestrelCaptureApi;
  }
}

export {};
