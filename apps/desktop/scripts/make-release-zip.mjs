#!/usr/bin/env node
/**
 * Build a zip Windows Explorer can open (Compress-Archive, single "FTC Sim" folder).
 * Also writes latest.yml for electron-updater and refreshes release/FTC-Sim/ (local copy).
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const releaseDir = path.join(desktopRoot, 'release');
const unpackedDir =
  process.env.FTC_SIM_UNPACKED_DIR ??
  (fs.existsSync(path.join(releaseDir, 'electron', 'win-unpacked'))
    ? path.join(releaseDir, 'electron', 'win-unpacked')
    : path.join(releaseDir, 'win-unpacked'));
const localDir = path.join(releaseDir, 'FTC-Sim');
const stagingDir = path.join(releaseDir, 'staging');
const stagingAppDir = path.join(stagingDir, 'FTC Sim');
const zipName = 'FTC-Sim-win-x64.zip';
const zipPath = path.join(releaseDir, zipName);
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const version = String(pkg.version);

function run(cmd, cwd = desktopRoot) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sha512Base64(filePath) {
  const hash = createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function writeLatestYml(filePath, size) {
  const sha512 = sha512Base64(filePath);
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${zipName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${zipName}`,
    `releaseDate: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), yml, 'utf8');
  console.log('[make-release-zip] Wrote latest.yml for auto-updater');
}

function dirSizeMb(root) {
  if (!fs.existsSync(root)) return 0;
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
  return total / (1024 * 1024);
}

function verifyBundledMatchServer(appRoot, label) {
  const nm = path.join(appRoot, 'resources', 'match-server', 'node_modules');
  const mb = dirSizeMb(nm);
  console.log(`[make-release-zip] ${label} match-server node_modules: ${mb.toFixed(1)} MB`);
  if (mb > 50) {
    console.error(
      `[make-release-zip] ${label} match-server is bloated (${mb.toFixed(1)} MB). Delete ${appRoot} and rebuild.`,
    );
    process.exit(1);
  }
}

function copyAppBundle(fromDir, toDir) {
  removeDirAggressive(toDir, toDir);
  fs.cpSync(fromDir, toDir, { recursive: true, force: true });
  const bundledServer = path.join(toDir, 'resources', 'match-server');
  const freshServer = path.join(desktopRoot, 'resources', 'match-server');
  if (!fs.existsSync(freshServer)) {
    console.error('[make-release-zip] Missing prepared resources/match-server — run pnpm prepare:resources first.');
    process.exit(1);
  }
  removeDirAggressive(bundledServer, `${path.basename(toDir)} match-server`);
  fs.cpSync(freshServer, bundledServer, { recursive: true, force: true });
  verifyBundledMatchServer(toDir, path.basename(toDir));
}

function removeDirAggressive(target, label) {
  try {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    console.log('[make-release-zip] Removed', label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[make-release-zip] Could not remove', label, '—', message);
  }
}

function cleanupReleaseDir() {
  const staleNames = [
    'win-unpacked',
    'staging',
    'release2',
    'builder-debug.yml',
    'FTC-Sim-win-x64-fixed.zip',
    'FTC-Sim-win-x64.building.zip',
    'FTC-Sim-robocopy',
    'FTC-Sim-test',
    'FTC-Sim-test2',
    'ms-copy-test',
  ];
  for (const name of staleNames) {
    removeDirAggressive(path.join(releaseDir, name), name);
  }
  removeDirAggressive(path.join(desktopRoot, 'apps'), 'apps/desktop/apps');
  try {
    for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/^FTC-Sim-v\d/i.test(entry.name)) {
        removeDirAggressive(path.join(releaseDir, entry.name), entry.name);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[make-release-zip] Cleanup scan failed:', message);
  }
}

if (!fs.existsSync(unpackedDir)) {
  console.error('[make-release-zip] Missing', unpackedDir, '— run pnpm run pack:dir first.');
  process.exit(1);
}

console.log('[make-release-zip] Refreshing local copy at release/FTC-Sim/…');
copyAppBundle(unpackedDir, localDir);
console.log('[make-release-zip] Local exe:', path.join(localDir, 'FTC Sim.exe'));

console.log('[make-release-zip] Copying app into staging/FTC Sim/…');
removeDirAggressive(stagingDir, 'release/staging');
fs.mkdirSync(stagingDir, { recursive: true });
copyAppBundle(unpackedDir, stagingAppDir);

console.log('[make-release-zip] Creating zip (Windows Compress-Archive, ~5 min, no progress bar)…');
const zipBuildingPath = path.join(releaseDir, 'FTC-Sim-win-x64.building.zip');
fs.rmSync(zipBuildingPath, { force: true });
run(
  `powershell -NoProfile -Command "Compress-Archive -Path ${psQuote(stagingAppDir)} -DestinationPath ${psQuote(zipBuildingPath)} -CompressionLevel Optimal -Force"`,
  desktopRoot,
);
fs.rmSync(zipPath, { force: true });
fs.renameSync(zipBuildingPath, zipPath);

fs.rmSync(stagingDir, { recursive: true, force: true });

const size = fs.statSync(zipPath).size;
writeLatestYml(zipPath, size);
cleanupReleaseDir();
console.log(`[make-release-zip] Done: ${zipPath} (${(size / (1024 * 1024)).toFixed(1)} MB, v${version})`);
