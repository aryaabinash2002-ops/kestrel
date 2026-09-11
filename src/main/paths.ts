import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves the on-disk layout. `settings.json` always lives in userData;
 * everything else lives in the (optionally user-chosen) data dir.
 */
export class Paths {
  constructor(private customDataDir: string | null) {}

  setDataDir(dir: string | null): void {
    this.customDataDir = dir;
    this.ensure();
  }

  get userData(): string {
    return app.getPath('userData');
  }
  get settingsFile(): string {
    return join(this.userData, 'settings.json');
  }
  get secretsFile(): string {
    return join(this.userData, 'secrets.enc');
  }
  get dataDir(): string {
    return this.customDataDir ?? join(this.userData, 'data');
  }
  get dbFile(): string {
    return join(this.dataDir, 'kestrel.db');
  }
  get filesDir(): string {
    return join(this.dataDir, 'files');
  }
  get screenshotsDir(): string {
    return join(this.filesDir, 'screenshots');
  }
  get documentsDir(): string {
    return join(this.filesDir, 'documents');
  }
  get exportsDir(): string {
    return join(this.dataDir, 'exports');
  }
  get logsDir(): string {
    return join(this.userData, 'logs');
  }

  ensure(): void {
    for (const d of [
      this.dataDir,
      this.filesDir,
      this.screenshotsDir,
      this.documentsDir,
      this.exportsDir,
      this.logsDir,
    ]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }
}
