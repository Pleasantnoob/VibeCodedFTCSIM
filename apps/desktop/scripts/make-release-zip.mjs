#!/usr/bin/env node
/**
 * Build a Windows Explorer–compatible zip (single "FTC Sim" folder inside).
 * electron-builder's zip target puts thousands of files at the archive root and
 * Windows often reports that as an invalid compressed folder.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const releaseDir = path.join(desktopRoot, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const stagingDir = path.join(releaseDir, 'staging');
const stagingAppDir = path.join(stagingDir, 'FTC Sim');
const zipPath = path.join(releaseDir, 'FTC-Sim-win-x64.zip');

function run(cmd, cwd = desktopRoot) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

if (!fs.existsSync(unpackedDir)) {
  console.error('[make-release-zip] Missing', unpackedDir, '— run electron-builder --dir first.');
  process.exit(1);
}

console.log('[make-release-zip] Staging win-unpacked as "FTC Sim/"…');
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

try {
  run(`mklink /J "${stagingAppDir}" "${unpackedDir}"`, desktopRoot);
} catch {
  console.log('[make-release-zip] Junction failed — copying folder (slower)…');
  fs.cpSync(unpackedDir, stagingAppDir, { recursive: true });
}

console.log('[make-release-zip] Creating zip (Windows tar)…');
fs.rmSync(zipPath, { force: true });
run(`tar -acf "${zipPath}" -C "${stagingDir}" "FTC Sim"`, desktopRoot);

fs.rmSync(stagingDir, { recursive: true, force: true });

const sizeMb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(1);
console.log(`[make-release-zip] Done: ${zipPath} (${sizeMb} MB)`);
