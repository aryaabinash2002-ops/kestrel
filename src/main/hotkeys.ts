import { globalShortcut } from 'electron';
import type { HotkeyBindings, HotkeyName } from '@shared/types/settings';
import { logger } from './logger';

const log = logger.scope('hotkeys');

export class HotkeyManager {
  private handlers = new Map<HotkeyName, () => void>();
  private registered = new Map<HotkeyName, string>();

  on(name: HotkeyName, fn: () => void): void {
    this.handlers.set(name, fn);
  }

  /** (Re)register all bindings. Returns the names that failed to register. */
  apply(bindings: HotkeyBindings): HotkeyName[] {
    this.unregisterAll();
    const failed: HotkeyName[] = [];
    for (const [name, accel] of Object.entries(bindings) as [HotkeyName, string][]) {
      if (!accel) continue;
      try {
        const ok = globalShortcut.register(accel, () => {
          log.debug('hotkey', name);
          this.handlers.get(name)?.();
        });
        if (ok) this.registered.set(name, accel);
        else failed.push(name);
      } catch (err) {
        log.warn('bad accelerator', name, accel, err);
        failed.push(name);
      }
    }
    if (failed.length) log.warn('failed to register hotkeys', failed.join(','));
    return failed;
  }

  unregisterAll(): void {
    for (const accel of this.registered.values()) {
      try {
        globalShortcut.unregister(accel);
      } catch {
        /* ignore */
      }
    }
    this.registered.clear();
  }
}
