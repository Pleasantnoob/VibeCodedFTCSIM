#!/usr/bin/env node
/**
 * Build web + match-server bundles and copy into apps/desktop/resources for Electron packaging.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const resourcesRoot = path.join(desktopRoot, 'resources');
const webOut = path.join(resourcesRoot, 'web');
const serverOut = path.join(resourcesRoot, 'match-server');

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
  run('powershell -NoProfile -ExecutionPolicy Bypass -File scripts/copy-ftc-assets.ps1');
  if (!fs.existsSync(required)) {
    console.warn('[prepare] Warning: match audio still missing — run FTC Live 2026 once, then copy-ftc-assets.ps1');
  }
}

ensureFtcLiveAssets();
console.log('[prepare] Building web UI…');
run('pnpm --filter @ftc-sim/web build');

console.log('[prepare] Building match-server…');
run('pnpm --filter @ftc-sim/match-server build');

console.log('[prepare] Copying web dist…');
fs.rmSync(webOut, { recursive: true, force: true });
fs.mkdirSync(resourcesRoot, { recursive: true });
fs.cpSync(path.join(repoRoot, 'apps/web/dist'), webOut, { recursive: true });

console.log('[prepare] Deploying match-server (production deps)…');
fs.rmSync(serverOut, { recursive: true, force: true });
run(`pnpm --config.confirmModulesPurge=false --filter @ftc-sim/match-server --prod deploy --legacy "${serverOut}"`);

console.log('[prepare] Done. Resources ready in apps/desktop/resources/');
