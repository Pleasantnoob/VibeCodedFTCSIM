import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePathFileText } from './load-path.js';

const here = dirname(fileURLToPath(import.meta.url));
const superDuoFar12 = readFileSync(
  join(here, '../../../apps/web/public/examples/super-duo-far12.pp'),
  'utf8',
);

describe('hairpin closestT', () => {
  it('does not snap to the far end when the robot is at the segment start (mqnmmpb5)', () => {
    const { autoSequence } = parsePathFileText(superDuoFar12);
    const pathSteps = autoSequence!.steps.filter((s) => s.kind === 'path');
    // mqnmmpb5 — second trip to (9,57) with control (7,15)
    const hairpin = pathSteps[8]!;
    const path = hairpin.chain.paths[0]!;
    const start = path.curve.getStart();

    const t = path.closestT({ x: start.x - 0.5, y: start.y, heading: start.heading });
    expect(t).toBeLessThan(0.25);

    const tHint = path.closestT(
      { x: start.x - 0.5, y: start.y, heading: start.heading },
      0,
    );
    expect(tHint).toBeLessThan(0.25);
  });

  it('does not snap to t=1 on Super Duo Near path#9 hairpin while near the start', () => {
    const near12 = readFileSync(
      join(here, '../../../apps/web/public/examples/super-duo-near12.pp'),
      'utf8',
    );
    const { autoSequence } = parsePathFileText(near12);
    const pathSteps = autoSequence!.steps.filter((s) => s.kind === 'path');
    const path = pathSteps[8]!.chain.paths[0]!;

    const t = path.closestT({ x: 16.0, y: 57.6, heading: 0 }, 0.085);
    expect(t).toBeLessThan(0.35);
    expect(t).toBeGreaterThanOrEqual(0);
  });
});
