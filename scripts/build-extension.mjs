// Bundles the MV3 extension into extension/dist (load unpacked) and extension/kestrel-extension.zip.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createIcons } from './make-icons.mjs';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'extension');
const out = resolve(src, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: {
    background: resolve(src, 'src/background.ts'),
    offscreen: resolve(src, 'src/offscreen.ts'),
    content: resolve(src, 'src/content/meetCaptions.ts'),
    popup: resolve(src, 'src/popup/popup.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  outdir: out,
  sourcemap: false,
  minify: false,
  alias: { '@shared': resolve(root, 'src/shared') },
  logLevel: 'info',
});

cpSync(resolve(src, 'public'), out, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(src, 'manifest.json'), 'utf8'));
manifest.version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
createIcons(resolve(out, 'icons'));

const zip = resolve(src, 'kestrel-extension.zip');
if (existsSync(zip)) rmSync(zip);
try {
  execSync(`cd "${out}" && zip -qr "${zip}" .`);
  console.log('extension zip:', zip);
} catch {
  console.log('zip not available; skipped archive');
}
console.log('extension built:', out);
