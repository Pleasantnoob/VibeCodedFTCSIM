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
    console.error('[prepare] Missing match audio — launch FTC Live 2026 once, then run scripts/copy-ftc-assets.ps1');
    process.exit(1);
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
run(`pnpm --config.confirmModulesPurge=false --config.node-linker=hoisted --config.package-import-method=copy --filter @ftc-sim/match-server --prod deploy --legacy "${serverOut}"`);

const rapierPath = path.join(serverOut, 'node_modules', '@dimforge', 'rapier2d-compat');
if (!fs.existsSync(rapierPath)) {
  console.error('[prepare] Deploy missing @dimforge/rapier2d-compat — Host Match will fail.');
  process.exit(1);
}

function dirSizeBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else total += fs.statSync(full).size;
    }
  }
  return total;
}

const nodeModulesPath = path.join(serverOut, 'node_modules');
const deployMb = dirSizeBytes(nodeModulesPath) / (1024 * 1024);
console.log(`[prepare] match-server node_modules: ${deployMb.toFixed(1)} MB`);
if (deployMb > 50) {
  console.error(
    '[prepare] match-server deploy is too large — expected <50 MB prod deps. Delete apps/desktop/resources/match-server and rebuild.',
  );
  process.exit(1);
}

console.log('[prepare] Done. Resources ready in apps/desktop/resources/');

const appVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'),
).version;
fs.writeFileSync(path.join(serverOut, 'app-version.txt'), `${appVersion}\n`, 'utf8');
console.log('[prepare] Wrote match-server app-version.txt:', appVersion);
