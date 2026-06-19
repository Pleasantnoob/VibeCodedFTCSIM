import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/assets');
const publicAssetsDir = join(dirname(fileURLToPath(import.meta.url)), '../public/assets');

const sources = [
  { in: 'purple-artifact-src.png', out: 'purple-artifact.webp' },
  { in: 'green-artifact-src.png', out: 'green-artifact.webp' },
];

function isColored(r, g, b) {
  return !(r < 40 && g < 40 && b < 40);
}

/** Remove only the outer black background; keep interior black holes/outlines. */
function removeOuterBackground(data, width, height) {
  let colorCount = 0;
  let sumX = 0;
  let sumY = 0;
  let maxDistSq = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isColored(r, g, b)) continue;
      colorCount++;
      sumX += x;
      sumY += y;
    }
  }

  if (colorCount === 0) return;

  const cx = sumX / colorCount;
  const cy = sumY / colorCount;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isColored(r, g, b)) continue;
      const dx = x - cx;
      const dy = y - cy;
      maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy);
    }
  }

  const ballRadius = Math.sqrt(maxDistSq) * 1.08;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isColored(r, g, b)) continue;

      const dx = x - cx;
      const dy = y - cy;
      const insideBall = dx * dx + dy * dy <= ballRadius * ballRadius;
      if (!insideBall) data[i + 3] = 0;
    }
  }
}

async function pngToWebp(input, output) {
  const inputPath = join(assetsDir, input);
  const { data, info } = await sharp(inputPath)
    .trim({ threshold: 15 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  removeOuterBackground(data, info.width, info.height);

  const webp = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ lossless: true })
    .toBuffer();

  writeFileSync(join(assetsDir, output), webp);
  console.log(`Wrote ${output} (${info.width}x${info.height})`);
}

for (const { in: input, out: output } of sources) {
  await pngToWebp(input, output);
}

// Keep public copies in sync for field.json references / preview builds.
for (const { out } of sources) {
  copyFileSync(join(assetsDir, out), join(publicAssetsDir, out));
}
