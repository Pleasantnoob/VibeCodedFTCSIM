#!/usr/bin/env node
/**
 * Sync FTC Live v7.5.0 public assets into the sim (audio, fonts, overlays, video, bundle).
 * Cross-platform replacement for scripts/copy-ftc-assets.ps1 (Windows desktop unchanged).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dest = path.join(repoRoot, 'apps/web/public/ftc-live');
const vendor = path.join(repoRoot, 'vendor/ftc-live-assets');

const AUDIO_ALIASES = {
  '3-2-1-02d002f8c74568631e6dc9990c9537f4.wav': '3-2-1.wav',
  'endauto-bcea0449f8e32349de8b72fa1688f0cf.wav': 'endauto.wav',
  'endauto_with_warning-76b904702aaed301b49f0bdee3de5fcb.wav': 'endauto_with_warning.wav',
  'endmatch-8f2d86fb5bcc3cae5d0adc2c27b64f93.wav': 'endmatch.wav',
  'charge-d9f8185a64572b9f7eef9a20e4d4b5b1.wav': 'charge.wav',
  'firebell-2f4e0af105ee5b70746e61c4f3faac96.wav': 'firebell.wav',
  'factwhistle-a6f08240d8c31040e3d400204ed65304.wav': 'factwhistle.wav',
  'results-9b4cddbef8bc2b6a2eba772704cf0754.wav': 'results.wav',
  'fogblast-ef516f3364f46f67c6ffdea072b9c2b0.wav': 'fogblast.wav',
  'unmute-490ab2286bb591e6ceabe812ce2db8db.wav': 'unmute.wav',
};

function candidateSources() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(localAppData, 'firstinspires', 'ftclive-2026-default', 'data', 'public'),
      path.join(home, 'Documents', 'FIRST Tech Challenge Live', 'DECODE (2026)', 'public'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'firstinspires', 'ftclive-2026-default', 'data', 'public'),
      path.join(home, 'Documents', 'FIRST Tech Challenge Live', 'DECODE (2026)', 'public'),
    );
  } else {
    candidates.push(
      path.join(home, '.local', 'share', 'firstinspires', 'ftclive-2026-default', 'data', 'public'),
      path.join(home, 'Documents', 'FIRST Tech Challenge Live', 'DECODE (2026)', 'public'),
    );
  }

  return candidates;
}

function findSource() {
  for (const candidate of candidateSources()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

function applyAudioAliases(audioDir) {
  for (const [hashed, alias] of Object.entries(AUDIO_ALIASES)) {
    const from = path.join(audioDir, hashed);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(audioDir, alias));
    }
  }
}

function dirStats(root) {
  let count = 0;
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        count += 1;
        total += fs.statSync(full).size;
      }
    }
  }
  return { count, mb: total / (1024 * 1024) };
}

function main() {
  const src = findSource();
  if (!src) {
    console.error('[copy-ftc-assets] FTC Live public assets not found. Launch FTC Live 2026 once, then re-run.');
    if (process.platform === 'win32') {
      console.error('Expected: %LOCALAPPDATA%\\firstinspires\\ftclive-2026-default\\data\\public');
    } else if (process.platform === 'darwin') {
      console.error('Expected: ~/Library/Application Support/firstinspires/ftclive-2026-default/data/public');
    }
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(vendor, { recursive: true });
  copyTree(src, dest);
  copyTree(src, vendor);
  applyAudioAliases(path.join(dest, 'audio'));

  const { count, mb } = dirStats(dest);
  console.log(`[copy-ftc-assets] Synced ${count} files (${mb.toFixed(1)} MB) from:\n  ${src}\nto:\n  ${dest}`);
}

main();
