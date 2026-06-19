#!/usr/bin/env node
/**
 * Build a Windows zip suitable for GitHub Releases.
 *
 * Usage: pnpm --filter @ftc-sim/desktop release
 * Output: apps/desktop/release/FTC-Sim-win-x64.zip
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const releaseDir = path.join(desktopRoot, 'release');

function run(cmd) {
  execSync(cmd, { cwd: desktopRoot, stdio: 'inherit', shell: true });
}

run('pnpm dist');

const zipPath = path.join(releaseDir, 'FTC-Sim-win-x64.zip');
if (!fs.existsSync(zipPath)) {
  console.error('[release] No zip found at', zipPath);
  process.exit(1);
}

console.log('\n[release] Built:', zipPath);
console.log('[release] Upload to GitHub Releases.');
