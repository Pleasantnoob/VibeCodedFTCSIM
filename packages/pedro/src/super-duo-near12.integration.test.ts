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
const superDuoNear12 = readFileSync(
  join(here, '../../../apps/web/public/examples/super-duo-near12.pp'),
  'utf8',
);

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

describe('Super Duo Near 12 AUTO', () => {
  it('follows without long zero-drive stalls around the 12s hairpin', () => {
    const { autoSequence } = parsePathFileText(superDuoNear12);
    expect(autoSequence).toBeDefined();

    const runner = new AutoSequenceRunner();
    let state = { pose: { ...autoSequence!.startPose }, linear: { x: 0, y: 0 }, angular: 0 };
    runner.setPose(state.pose);
    runner.start(autoSequence!.steps);

    let stallTicks = 0;
    let worstStall = 0;
    let worstPose: { x: number; y: number } | null = null;
    let worstElapsed = 0;
    let worstStep = 0;
    let maxDistFromStart = 0;
    const start = { ...state.pose };

    for (let i = 0; i < 18_000 && runner.isRunning(); i++) {
      const elapsed = i * dt;
      runner.setPose(state.pose);
      runner.setVelocity(state.linear);
      const inWait = runner.isInAutoWait();
      const input = runner.updateHolonomic(dt, LIMITS);
      const mag =
        Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn);
      const speed = Math.hypot(state.linear.x, state.linear.y);
      const dbg = runner.getRunnerDebug();

      maxDistFromStart = Math.max(
        maxDistFromStart,
        Math.hypot(state.pose.x - start.x, state.pose.y - start.y),
      );

      if (!inWait && mag < 0.02 && speed < 2 && runner.isRunning()) {
        stallTicks += 1;
        if (stallTicks > worstStall) {
          worstStall = stallTicks;
          worstPose = { x: state.pose.x, y: state.pose.y };
          worstElapsed = elapsed;
          worstStep = dbg.stepIndex + 1;
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
        barriers: DECODE_BARRIERS,
        fieldSizeInches: 144,
        driveFrame: 'robot',
        maxAcceleration: 48,
        maxAngularAcceleration: 18,
      });
    }

    expect(
      worstStall,
      `stalled ${worstStall} ticks at t=${worstElapsed.toFixed(1)}s step=${worstStep} near (${worstPose?.x.toFixed(1)}, ${worstPose?.y.toFixed(1)})`,
    ).toBeLessThan(120);
    expect(maxDistFromStart).toBeGreaterThan(18);
    expect(runner.isRunning(), `AUTO did not finish — ended at (${state.pose.x.toFixed(1)},${state.pose.y.toFixed(1)})`).toBe(false);
    const finalPath = autoSequence!.steps.filter((s) => s.kind === 'path').at(-1)!;
    const finalEnd = finalPath.chain.paths.at(-1)!.curve.getEnd();
    expect(Math.hypot(state.pose.x - finalEnd.x, state.pose.y - finalEnd.y)).toBeLessThan(8);
  });
});
