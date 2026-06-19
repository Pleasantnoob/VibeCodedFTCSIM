import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(root, 'apps/web/public/ftc-live/css/displayContainer.css');
const outPath = path.join(root, 'apps/web/public/ftc-live/css/match-results-scoped.css');

const src = fs.readFileSync(srcPath, 'utf8');
const scope = '.match-results-ceremony__viewport';
const keep =
  /primaryMatchContainer|matchTopBar|matchBottomBar|resultsWrapper|resultsSet|scoreRegion|scoreSpan|scoreBackground|resultsUpperWrapper|resultsTeam|resultsComponents|resultsBreakdownKey|winSpan|fa-trophy|allianceName|programLogo|gameLogo|pageTitle|pageName|eventName|resultsPage|\.h-100|\.w-100|season-background|--FIRST-|--darkened-|--season-/;

const lines = [];
for (const match of src.matchAll(/:root\{[^}]+\}/g)) {
  const vars = match[0]
    .slice(6, -1)
    .replace(/url\(\/bundle\//g, 'url(/ftc-live/bundle/');
  lines.push(`${scope}{${vars}}`);
}

for (const block of src.split('}')) {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith('@')) continue;
  const brace = trimmed.indexOf('{');
  if (brace < 0) continue;
  const selectors = trimmed.slice(0, brace);
  const body = trimmed
    .slice(brace + 1)
    .replace(/url\(\/bundle\//g, 'url(/ftc-live/bundle/')
    .replace(/url\(\/ftc-live\/ftc-live\//g, 'url(/ftc-live/');
  if (/^(body|html)\b/.test(selectors)) continue;
  if (!keep.test(`${selectors}{${body}}`)) continue;
  const prefixed = selectors
    .split(',')
    .map((s) => {
      s = s.trim();
      if (!s || s.startsWith('@')) return s;
      if (s === ':root') return scope;
      return `${scope} ${s}`;
    })
    .filter(Boolean)
    .join(',');
  lines.push(`${prefixed}{${body}}`);
}

fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${lines.length} scoped rules to ${outPath}`);
