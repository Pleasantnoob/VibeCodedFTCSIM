import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../public/assets');

for (const file of ['purple-artifact.png', 'green-artifact.png']) {
  const path = join(assetsDir, file);
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r < 48 && g < 48 && b < 48) data[i + 3] = 0;
  }
  const out = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  writeFileSync(path, out);
  console.log(`Updated ${file} (${info.width}x${info.height})`);
}
