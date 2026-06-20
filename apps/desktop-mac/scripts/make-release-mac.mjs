#!/usr/bin/env node
/**
 * Write latest-mac-{arch}.yml for electron-updater after electron-builder produces Mac artifacts.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopMacRoot = path.resolve(here, '..');
const releaseDir = path.join(desktopMacRoot, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopMacRoot, 'package.json'), 'utf8'));
const version = String(pkg.version);
const arch = process.env.FTC_MAC_ARCH ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
const zipName = `FTC-Sim-Player-${version}-mac-${arch}.zip`;

function sha512Base64(filePath) {
  const hash = createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function findZip() {
  const direct = path.join(releaseDir, zipName);
  if (fs.existsSync(direct)) {
    return direct;
  }
  if (!fs.existsSync(releaseDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(releaseDir)) {
    if (entry.endsWith('.zip') && entry.includes('FTC-Sim-Player') && entry.includes(`mac-${arch}`)) {
      return path.join(releaseDir, entry);
    }
  }
  return null;
}

const zipPath = findZip();
if (!zipPath) {
  console.error('[make-release-mac] Missing zip in', releaseDir, '— run electron-builder first.');
  if (fs.existsSync(releaseDir)) {
    console.error('[make-release-mac] Found:', fs.readdirSync(releaseDir).join(', '));
  }
  process.exit(1);
}

const size = fs.statSync(zipPath).size;
const sha512 = sha512Base64(zipPath);
const actualName = path.basename(zipPath);
const yml = [
  `version: ${version}`,
  'files:',
  `  - url: ${actualName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${actualName}`,
  `releaseDate: ${new Date().toISOString()}`,
  '',
].join('\n');

const ymlName = `latest-mac-${arch}.yml`;
fs.writeFileSync(path.join(releaseDir, ymlName), yml, 'utf8');

const dmgCandidates = fs
  .readdirSync(releaseDir)
  .filter((name) => name.endsWith('.dmg') && name.includes(`mac-${arch}`));
for (const dmg of dmgCandidates) {
  console.log('[make-release-mac] DMG:', path.join(releaseDir, dmg));
}

console.log('[make-release-mac] Zip:', zipPath, `(${(size / (1024 * 1024)).toFixed(1)} MB, v${version}, ${arch})`);
console.log('[make-release-mac] Wrote', ymlName, 'for auto-updater');
