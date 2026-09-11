import { dialog } from 'electron';
import { copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AppContext } from '../context';
import { handle } from '../ipc';
import { parseDocument } from '../docs/parseResume';
import { importUrl } from '../docs/importUrl';
import { uid } from '@shared/utils';

export function registerProfileHandlers(ctx: AppContext): void {
  handle('profiles:parseDocument', (_e, source) => parseDocument(source));
  handle('profiles:importUrl', (_e, url) => importUrl(url));
  handle('profiles:pickDocument', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a résumé or job description',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    const path = res.filePaths[0];
    if (res.canceled || !path) return null;
    const parsed = await parseDocument({ path, filename: basename(path) });
    // Keep a local copy next to the database so the original can be re-read later.
    try {
      copyFileSync(path, join(ctx.paths.documentsDir, `${uid('doc')}_${basename(path)}`));
    } catch {
      /* non-fatal */
    }
    return parsed;
  });
}
