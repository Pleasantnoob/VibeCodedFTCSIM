#!/usr/bin/env node
/**
 * Build web bundle and copy into apps/desktop-mac/resources for Electron packaging.
 * Player-only: no match-server.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopMacRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopMacRoot, '../..');
const resourcesRoot = path.join(desktopMacRoot, 'resources');
const webOut = path.join(resourcesRoot, 'web');

function run(cmd) {
  execSync(cmd, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PNPM_CONFIRM_MODULES_PURGE: 'false' },
  });
}

function ensureFtcLiveAssets() {
  const audioDir = path.join(repoRoot, 'apps/web/public/ftc-live/audio');
  const required = path.join(audioDir, '3-2-1.wav');
  if (fs.existsSync(required)) {
    console.log('[prepare] FTC Live audio already present.');
    return;
  }
  console.log('[prepare] Syncing FTC Live audio/fonts (one-time copy from FTC Live install)…');
  run('node scripts/copy-ftc-assets.mjs');
  if (!fs.existsSync(required)) {
    console.warn('[prepare] Missing match audio — launch FTC Live 2026 once, then run node scripts/copy-ftc-assets.mjs');
    console.warn('[prepare] Continuing without full audio (join client still works).');
  }
}

ensureFtcLiveAssets();
console.log('[prepare] Building web UI…');
run('pnpm --filter @ftc-sim/web build');

console.log('[prepare] Copying web dist…');
fs.rmSync(webOut, { recursive: true, force: true });
fs.mkdirSync(resourcesRoot, { recursive: true });
fs.cpSync(path.join(repoRoot, 'apps/web/dist'), webOut, { recursive: true });

console.log('[prepare] Done. Resources ready in apps/desktop-mac/resources/');
