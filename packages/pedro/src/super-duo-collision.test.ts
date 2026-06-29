import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KINEMATIC_ROBOT, stepVelocityDrive, resolveMutualRobotCollisions } from '@ftc-sim/robot';
import { AutoSequenceRunner } from './auto-sequence.js';
import { parsePathFileText } from './load-path.js';

const DECODE_BARRIERS = [
  [
    { x: 6, y: 119 },
    { x: 25, y: 144 },
    { x: 0, y: 144 },
    { x: 0, y: 70 },
    { x: 6, y: 72 },
  ],
  [
    { x: 144, y: 70 },
    { x: 144, y: 144 },
    { x: 120, y: 144 },
    { x: 138, y: 119 },
    { x: 138, y: 72 },
    { x: 144, y: 72 },
  ],
];

const here = dirname(fileURLToPath(import.meta.url));
const superDuoFar12 = readFileSync(
  join(here, '../../../apps/web/public/examples/super-duo-far12.pp'),
  'utf8',
);

describe('Super Duo Far 12 with player collision', () => {
  it('does not freeze on path after 17s wait when player blocks home', () => {
    const { autoSequence } = parsePathFileText(superDuoFar12);
    const LIMITS = DEFAULT_KINEMATIC_ROBOT.limits;
    const FOOTPRINT = DEFAULT_KINEMATIC_ROBOT.footprint;
    const dt = 1 / 120;

    const runner = new AutoSequenceRunner();
    let bot = { pose: { ...autoSequence!.startPose }, linear: { x: 0, y: 0 }, angular: 0 };
    const player = {
      pose: { x: 50, y: 12, heading: Math.PI / 2 },
      linear: { x: 0, y: 0 },
      angular: 0,
      footprint: FOOTPRINT,
    };
    runner.setPose(bot.pose);
    runner.start(autoSequence!.steps);

    let pathDriveAt18 = 0;
    let stuckAfter17 = 0;

    for (let i = 0; i < 120 * 30 && runner.isRunning(); i++) {
      const elapsed = i * dt;
      runner.setPose(bot.pose);
      runner.setVelocity(bot.linear);
      const input = runner.updateHolonomic(dt, LIMITS);
      const mag =
        Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn);

      if (elapsed >= 17.2 && elapsed <= 19 && !runner.isInAutoWait() && mag > 0.05) {
        pathDriveAt18 += 1;
      }
      if (elapsed >= 17.5 && elapsed <= 20 && mag < 0.02 && !runner.isInAutoWait()) {
        stuckAfter17 += 1;
      }

      bot = stepVelocityDrive({
        ...bot,
        input,
        dt,
        limits: LIMITS,
        footprint: FOOTPRINT,
        barriers: DECODE_BARRIERS,
        fieldSizeInches: 144,
        driveFrame: 'robot',
        maxAcceleration: 48,
        maxAngularAcceleration: 18,
      });

      resolveMutualRobotCollisions(
        [
          { pose: bot.pose, linear: bot.linear, angular: bot.angular, footprint: FOOTPRINT },
          { pose: player.pose, linear: player.linear, angular: player.angular, footprint: FOOTPRINT },
        ],
        dt,
      );
    }

    expect(pathDriveAt18).toBeGreaterThan(30);
    expect(stuckAfter17).toBeLessThan(60);
  });
});
