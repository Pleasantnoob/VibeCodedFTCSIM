import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = path.join(root, 'node_modules/.pnpm/electron@35.7.5/node_modules/electron');
const version = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8')).version;
const distPath = path.join(electronDir, 'dist');
const cacheGlob = path.join(process.env.LOCALAPPDATA ?? '', 'electron', 'Cache', '*', `electron-v${version}-win32-x64.zip`);

if (fs.existsSync(path.join(distPath, 'electron.exe')) && fs.existsSync(path.join(electronDir, 'path.txt'))) {
  console.log('[fix-electron] Already installed.');
  process.exit(0);
}

console.log('[fix-electron] Running electron install.js …');
const install = spawnSync(process.execPath, ['install.js'], { cwd: electronDir, stdio: 'inherit', env: { ...process.env, force_no_cache: 'true' } });
if (install.status === 0 && fs.existsSync(path.join(distPath, 'electron.exe'))) {
  console.log('[fix-electron] install.js succeeded.');
  process.exit(0);
}

const cacheDirs = fs.readdirSync(path.join(process.env.LOCALAPPDATA ?? '', 'electron', 'Cache'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(d.parentPath, d.name, `electron-v${version}-win32-x64.zip`))
  .filter((p) => fs.existsSync(p));

if (cacheDirs.length === 0) {
  console.error('[fix-electron] No cached zip. Run install.js with network first.');
  process.exit(install.status ?? 1);
}

const zipPath = cacheDirs[0];
console.log('[fix-electron] Extracting cached zip via PowerShell …', zipPath);
fs.rmSync(distPath, { recursive: true, force: true });
const ps = spawnSync(
  'powershell',
  ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distPath.replace(/'/g, "''")}' -Force`],
  { stdio: 'inherit' },
);
if (ps.status !== 0) process.exit(ps.status ?? 1);
fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
console.log('[fix-electron] Done:', path.join(distPath, 'electron.exe'));

