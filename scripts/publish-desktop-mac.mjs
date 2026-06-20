#!/usr/bin/env node
/**
 * Publish Mac player build via GitHub Actions (no Mac required).
 *
 * Usage:
 *   node scripts/publish-desktop-mac.mjs          # create tag + push (triggers CI)
 *   node scripts/publish-desktop-mac.mjs --dry-run
 *
 * Requires: git, GitHub remote, and push access to Pleasantnoob/VibeCodedFTCSIM
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pkgPath = path.join(repoRoot, 'apps/desktop-mac/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = String(pkg.version);
const tag = `desktop-mac-v${version}`;
const dryRun = process.argv.includes('--dry-run');

function run(cmd) {
  console.log(`> ${cmd}`);
  if (!dryRun) {
    execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
  }
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

console.log(`\nFTC Sim Player Mac release v${version}`);
console.log(`Tag: ${tag}\n`);

const status = git('status --porcelain');
const macFiles = status
  .split('\n')
  .filter(Boolean)
  .filter((line) => line.includes('desktop-mac') || line.includes('.github/workflows/desktop-mac'));

if (status && !dryRun) {
  const hasMacChanges = macFiles.length > 0;
  if (hasMacChanges) {
    console.log('Uncommitted Mac release files detected. Commit them first, then re-run.\n');
    console.log(status);
    process.exit(1);
  }
}

try {
  const existing = git(`tag -l ${tag}`);
  if (existing === tag) {
    console.log(`Tag ${tag} already exists locally.`);
    if (!dryRun) {
      const answer = process.argv.includes('--force');
      if (!answer) {
        console.log('Re-run with --force to delete and recreate the tag, or bump version in apps/desktop-mac/package.json');
        process.exit(1);
      }
      run(`git tag -d ${tag}`);
      try {
        run(`git push origin :refs/tags/${tag}`);
      } catch {
        console.warn('[publish] Remote tag delete skipped (may not exist on remote).');
      }
    }
  }
} catch {
  /* no tags yet */
}

console.log('Steps:');
console.log('  1. Push your branch to GitHub (if not already)');
console.log('  2. Create tag and push — GitHub Actions builds .dmg on macOS');
console.log('  3. Download FTC-Sim-Player-mac-*.zip from Releases and send to Mac friends\n');

run(`git tag ${tag}`);
run(`git push origin HEAD`);
run(`git push origin ${tag}`);

console.log('\nDone. Watch the build:');
console.log('  https://github.com/Pleasantnoob/VibeCodedFTCSIM/actions/workflows/desktop-mac-release.yml');
console.log('\nWhen finished, download from Releases:');
console.log(`  FTC-Sim-Player-mac-${version}.zip  (both DMGs + install guide)`);
console.log('  or individual *-mac-arm64.dmg / *-mac-x64.dmg\n');
