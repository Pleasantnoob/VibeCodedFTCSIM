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

if (!fs.existsSync(unpackedDir)) {
  console.error('[make-release-zip] Missing', unpackedDir, '— run pnpm run pack:dir first.');
  process.exit(1);
}

console.log('[make-release-zip] Refreshing local copy at release/FTC-Sim/…');
fs.rmSync(localDir, { recursive: true, force: true });
fs.cpSync(unpackedDir, localDir, { recursive: true, force: true });
console.log('[make-release-zip] Local exe:', path.join(localDir, 'FTC Sim.exe'));

console.log('[make-release-zip] Copying app into staging/FTC Sim/…');
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.cpSync(unpackedDir, stagingAppDir, { recursive: true, force: true });

console.log('[make-release-zip] Creating zip (Windows Compress-Archive)…');
fs.rmSync(zipPath, { force: true });
run(
  `powershell -NoProfile -Command "Compress-Archive -Path ${psQuote(stagingAppDir)} -DestinationPath ${psQuote(zipPath)} -CompressionLevel Fastest -Force"`,
  desktopRoot,
);

fs.rmSync(stagingDir, { recursive: true, force: true });

const size = fs.statSync(zipPath).size;
writeLatestYml(zipPath, size);
console.log(`[make-release-zip] Done: ${zipPath} (${(size / (1024 * 1024)).toFixed(1)} MB, v${version})`);
