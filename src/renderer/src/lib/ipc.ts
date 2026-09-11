import type { IpcEventChannel, IpcEventMap, IpcInvokeChannel, IpcInvokeMap, KestrelApi } from '@shared/types/ipc';

const missing: KestrelApi = {
  invoke: async () => {
    throw new Error('Kestrel bridge not available');
  },
  on: () => () => {},
  send: () => {},
  platform: 'darwin',
};

export const kestrel: KestrelApi = typeof window !== 'undefined' && window.kestrel ? window.kestrel : missing;

export function invoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeMap[C]['args']
): Promise<IpcInvokeMap[C]['result']> {
  return kestrel.invoke(channel, ...args);
}

export function on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventMap[C]) => void): () => void {
  return kestrel.on(channel, listener);
}

export const isMac = kestrel.platform === 'darwin';
export const modKey = isMac ? '⌘' : 'Ctrl';

/** Render an Electron accelerator like "CommandOrControl+Shift+A" as "⌘⇧A" / "Ctrl+Shift+A". */
export function prettyAccelerator(accel: string): string {
  const parts = accel.split('+').map((p) => p.trim());
  if (isMac) {
    return parts
      .map((p) => {
        switch (p) {
          case 'CommandOrControl':
          case 'Command':
          case 'Cmd':
            return '⌘';
          case 'Control':
          case 'Ctrl':
            return '⌃';
          case 'Shift':
            return '⇧';
          case 'Alt':
          case 'Option':
            return '⌥';
          default:
            return p;
        }
      })
      .join('');
  }
  return parts.map((p) => (p === 'CommandOrControl' ? 'Ctrl' : p)).join('+');
}
