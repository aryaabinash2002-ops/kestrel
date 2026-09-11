import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings';
import type { DeepPartial } from '@shared/types/ipc';
import { deepMerge } from '@shared/utils';
import { logger } from './logger';

const log = logger.scope('settings');

/** Keys that must never be persisted in settings.json (belong in the secret store). */
const FORBIDDEN_KEYS = ['apiKey', 'anthropicKey', 'deepgramKey', 'assemblyaiKey', 'token'];

export class SettingsStore extends EventEmitter {
  private settings: Settings;

  constructor(private file: string) {
    super();
    this.settings = this.load();
  }

  private load(): Settings {
    if (!existsSync(this.file)) return structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
      merged.version = 1;
      return merged;
    } catch (err) {
      log.warn('settings.json unreadable, using defaults', err);
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  get(): Settings {
    return structuredClone(this.settings);
  }

  set(patch: DeepPartial<Settings>): Settings {
    this.assertNoSecrets(patch);
    const prev = this.settings;
    this.settings = deepMerge(structuredClone(this.settings), patch);
    this.settings.version = 1;
    this.save();
    this.emit('changed', this.get(), prev);
    return this.get();
  }

  private assertNoSecrets(obj: unknown, path = ''): void {
    if (typeof obj !== 'object' || obj === null) return;
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.includes(k)) throw new Error(`Refusing to store secret-like key "${path}${k}" in settings`);
      this.assertNoSecrets(v, `${path}${k}.`);
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  onChange(listener: (next: Settings, prev: Settings) => void): () => void {
    this.on('changed', listener);
    return () => this.off('changed', listener);
  }
}
