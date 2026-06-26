import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KINEMATIC_ROBOT, stepVelocityDrive } from '@ftc-sim/robot';
import { AutoSequenceRunner } from './auto-sequence.js';
import { parsePathFileText } from './load-path.js';

const LIMITS = DEFAULT_KINEMATIC_ROBOT.limits;
const FOOTPRINT = DEFAULT_KINEMATIC_ROBOT.footprint;
const dt = 1 / 120;

const here = dirname(fileURLToPath(import.meta.url));
const superDuoFar12 = readFileSync(
  join(here, '../../../apps/web/public/examples/super-duo-far12.pp'),
  'utf8',
);

/** Blue goal barrier (chamfered gate lip) — enough to catch gate wedging regressions. */
const BLUE_GOAL_BARRIER = [
  { x: 6, y: 119 },
  { x: 25, y: 144 },
  { x: 0, y: 144 },
  { x: 0, y: 70 },
  { x: 6, y: 72 },
];

describe('Super Duo Far 12 AUTO', () => {
  it('follows without long zero-drive stalls mid-path', () => {
    const { autoSequence } = parsePathFileText(superDuoFar12);
    expect(autoSequence).toBeDefined();

    const runner = new AutoSequenceRunner();
    let state = { pose: { ...autoSequence!.startPose }, linear: { x: 0, y: 0 }, angular: 0 };
    runner.setPose(state.pose);
    runner.start(autoSequence!.steps);

    let stallTicks = 0;
    let worstStall = 0;
    let worstPose: { x: number; y: number } | null = null;
    let maxDistFromStart = 0;
    const start = { ...state.pose };

    for (let i = 0; i < 18_000 && runner.isRunning(); i++) {
      runner.setPose(state.pose);
      runner.setVelocity(state.linear);
      const inWait = runner.shouldAutoShoot();
      const input = runner.updateHolonomic(dt, LIMITS);
      const mag =
        Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn);
      const speed = Math.hypot(state.linear.x, state.linear.y);

      maxDistFromStart = Math.max(
        maxDistFromStart,
        Math.hypot(state.pose.x - start.x, state.pose.y - start.y),
      );

      if (!inWait && mag < 0.02 && speed < 2 && runner.isRunning()) {
        stallTicks += 1;
        if (stallTicks > worstStall) {
          worstStall = stallTicks;
          worstPose = { x: state.pose.x, y: state.pose.y };
        }
      } else if (!inWait) {
        stallTicks = 0;
      }

      state = stepVelocityDrive({
        ...state,
        input,
        dt,
        limits: LIMITS,
        footprint: FOOTPRINT,
        barriers: [BLUE_GOAL_BARRIER],
        fieldSizeInches: 144,
        driveFrame: 'robot',
        maxAcceleration: 48,
        maxAngularAcceleration: 18,
      });
    }

    expect(
      worstStall,
      `stalled ${worstStall} ticks near (${worstPose?.x.toFixed(1)}, ${worstPose?.y.toFixed(1)})`,
    ).toBeLessThan(120);
    expect(maxDistFromStart).toBeGreaterThan(18);
    expect(runner.getProgress().completion).toBeGreaterThan(0.15);
  });
});
