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

function run(cmd) {
  execSync(cmd, { cwd: desktopRoot, stdio: 'inherit', shell: true });
}

run('pnpm dist');

const releaseDir = path.join(desktopRoot, 'release');
const zips = fs.readdirSync(releaseDir).filter((f) => f.endsWith('.zip'));
if (zips.length === 0) {
  console.error('[release] No zip found in', releaseDir);
  process.exit(1);
}

console.log('\n[release] Built:', path.join(releaseDir, zips[zips.length - 1]));
console.log('[release] Upload this file to GitHub Releases.');
