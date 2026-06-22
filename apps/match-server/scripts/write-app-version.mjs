#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const matchServerRoot = path.resolve(here, '..');
const repoRoot = path.resolve(matchServerRoot, '../..');
const webPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'),
);
const version = String(webPkg.version ?? '0.0.0');
const out = path.join(matchServerRoot, 'dist/app-version.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${version}\n`, 'utf8');
console.log('[write-app-version]', version, '→', out);
