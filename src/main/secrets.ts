import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import type { SecretKey } from '@shared/types/settings';
import { logger } from './logger';

const log = logger.scope('secrets');
const SERVICE = 'app.kestrel.copilot';

type Backend = 'keychain' | 'safeStorage' | 'plain';

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * API keys live in the OS keychain via keytar. If keytar cannot load (e.g. a broken
 * native build) we fall back to Electron's safeStorage (OS-encrypted blob on disk).
 * Values are never logged and never written in plain text.
 */
export class SecretStore {
  private keytar: KeytarLike | null = null;
  private backend: Backend = 'plain';
  private cache = new Map<SecretKey, string | null>();

  constructor(private fallbackFile: string) {}

  async init(): Promise<void> {
    try {
      const mod = (await import('keytar')) as unknown as { default?: KeytarLike } & KeytarLike;
      this.keytar = mod.default ?? mod;
      // Probe: keytar throws on platforms where the keychain is unavailable.
      await this.keytar.getPassword(SERVICE, '__probe__');
      this.backend = 'keychain';
    } catch (err) {
      log.warn('keytar unavailable, falling back to safeStorage', err);
      this.keytar = null;
      this.backend = safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'plain';
      if (this.backend === 'plain') {
        log.error('No OS encryption available; secrets will NOT be persisted');
      }
    }
    log.info('secret backend:', this.backend);
  }

  getBackend(): Backend {
    return this.backend;
  }

  private inflight = new Map<SecretKey, Promise<string | null>>();

  async get(key: SecretKey): Promise<string | null> {
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    // Coalesce concurrent first reads so the keychain is hit once.
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      const t0 = Date.now();
      let value: string | null = null;
      if (this.keytar) {
        value = await this.keytar.getPassword(SERVICE, key);
      } else if (this.backend === 'safeStorage') {
        value = this.readFallback()[key] ?? null;
      }
      this.cache.set(key, value);
      const ms = Date.now() - t0;
      if (ms > 250) log.warn(`keychain read for ${key} took ${ms} ms`);
      else log.debug(`keychain read for ${key} in ${ms} ms`);
      return value;
    })();
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Read all keys once at startup so the first LLM/STT request never waits on the keychain. */
  async preload(): Promise<void> {
    await Promise.all((['anthropic', 'deepgram', 'assemblyai'] as SecretKey[]).map((k) => this.get(k)));
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) return this.delete(key);
    if (this.keytar) {
      await this.keytar.setPassword(SERVICE, key, trimmed);
    } else if (this.backend === 'safeStorage') {
      const all = this.readFallback();
      all[key] = trimmed;
      this.writeFallback(all);
    }
    this.cache.set(key, trimmed);
    log.info('secret stored', key);
  }

  async delete(key: SecretKey): Promise<void> {
    if (this.keytar) await this.keytar.deletePassword(SERVICE, key);
    else if (this.backend === 'safeStorage') {
      const all = this.readFallback();
      delete all[key];
      this.writeFallback(all);
    }
    this.cache.set(key, null);
  }

  async has(key: SecretKey): Promise<boolean> {
    return !!(await this.get(key));
  }

  async status(): Promise<Record<SecretKey, boolean>> {
    return {
      anthropic: await this.has('anthropic'),
      deepgram: await this.has('deepgram'),
      assemblyai: await this.has('assemblyai'),
    };
  }

  async clearAll(): Promise<void> {
    for (const k of ['anthropic', 'deepgram', 'assemblyai'] as SecretKey[]) await this.delete(k);
    if (existsSync(this.fallbackFile)) unlinkSync(this.fallbackFile);
  }

  private readFallback(): Partial<Record<SecretKey, string>> {
    if (!existsSync(this.fallbackFile)) return {};
    try {
      const buf = readFileSync(this.fallbackFile);
      return JSON.parse(safeStorage.decryptString(buf)) as Partial<Record<SecretKey, string>>;
    } catch (err) {
      log.warn('could not decrypt fallback secrets file', err);
      return {};
    }
  }

  private writeFallback(all: Partial<Record<SecretKey, string>>): void {
    writeFileSync(this.fallbackFile, safeStorage.encryptString(JSON.stringify(all)));
  }
}
