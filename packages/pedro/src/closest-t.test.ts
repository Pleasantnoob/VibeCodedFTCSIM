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
});
