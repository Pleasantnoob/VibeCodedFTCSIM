#!/usr/bin/env node
/**
 * Build Mac artifacts suitable for GitHub Releases.
 *
 * Usage: pnpm --filter @ftc-sim/desktop-mac release
 * Output: apps/desktop-mac/release/FTC-Sim-Player-{version}-mac-{arch}.dmg and .zip
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopMacRoot = path.resolve(here, '..');
const releaseDir = path.join(desktopMacRoot, 'release');

function run(cmd) {
  execSync(cmd, { cwd: desktopMacRoot, stdio: 'inherit', shell: true });
}

if (process.platform !== 'darwin') {
  console.warn('[release] Mac packaging requires macOS. Use GitHub Actions desktop-mac-release workflow.');
}

run('pnpm dist');

const artifacts = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((name) => name.includes('FTC-Sim-Player'))
  : [];

if (artifacts.length === 0) {
  console.error('[release] No Mac artifacts found in', releaseDir);
  process.exit(1);
}

console.log('\n[release] Built:');
for (const name of artifacts) {
  console.log('  ', path.join(releaseDir, name));
}
console.log('[release] Upload to GitHub Releases as "FTC Sim Player for Mac".');
