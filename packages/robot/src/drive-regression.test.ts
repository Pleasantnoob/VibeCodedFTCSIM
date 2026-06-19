import { describe, expect, it } from 'vitest';
import { stepVelocityDrive } from './velocity-drive.js';
import { DEFAULT_KINEMATIC_ROBOT } from './types.js';

const DT = 1 / 120;
const IDLE = { forward: 0, strafe: 0, turn: 0 };

function runFrames(
  frames: number,
  input: { forward: number; strafe: number; turn: number },
  start = { x: 56, y: 40, heading: Math.PI / 2 },
) {
  let pose = { ...start };
  let linear = { x: 0, y: 0 };
  let angular = 0;

  for (let i = 0; i < frames; i++) {
    const next = stepVelocityDrive({
      pose,
      linear,
      angular,
      input,
      dt: DT,
      limits: DEFAULT_KINEMATIC_ROBOT.limits,
      footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
      barriers: [],
      fieldSizeInches: 144,
    });
    pose = next.pose;
    linear = next.linear;
    angular = next.angular;
  }

  return { pose, linear, angular };
}

describe('drive regression', () => {
  it('coasts to zero after north drive and release', () => {
    runFrames(120, { forward: 1, strafe: 0, turn: 0 });
    let signFlips = 0;
    let prevVy = 0;
    let state = runFrames(120, { forward: 1, strafe: 0, turn: 0 });

    for (let i = 0; i < 480; i++) {
      const next = stepVelocityDrive({
        pose: state.pose,
        linear: state.linear,
        angular: state.angular,
        input: IDLE,
        dt: DT,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [],
        fieldSizeInches: 144,
      });
      if (Math.abs(prevVy) > 1 && Math.sign(prevVy) !== Math.sign(next.linear.y)) {
        signFlips++;
      }
      prevVy = next.linear.y;
      state = next;
    }

    expect(signFlips).toBeLessThanOrEqual(1);
    expect(Math.hypot(state.linear.x, state.linear.y)).toBeLessThan(0.2);
    expect(Math.abs(state.angular)).toBeLessThan(0.05);
  });

  it('coasts to zero after strafe drive and release', () => {
    let state = runFrames(120, { forward: 0, strafe: -1, turn: 0 });
    let signFlips = 0;
    let prevVx = state.linear.x;

    for (let i = 0; i < 480; i++) {
      const next = stepVelocityDrive({
        pose: state.pose,
        linear: state.linear,
        angular: state.angular,
        input: IDLE,
        dt: DT,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [],
        fieldSizeInches: 144,
      });
      if (Math.abs(prevVx) > 1 && Math.sign(prevVx) !== Math.sign(next.linear.x)) {
        signFlips++;
      }
      prevVx = next.linear.x;
      state = next;
    }

    expect(signFlips).toBeLessThanOrEqual(1);
    expect(Math.hypot(state.linear.x, state.linear.y)).toBeLessThan(0.2);
  });

  it('settles rotation after turn input release', () => {
    let state = runFrames(90, { forward: 0, strafe: 0, turn: 1 });

    for (let i = 0; i < 480; i++) {
      state = stepVelocityDrive({
        pose: state.pose,
        linear: state.linear,
        angular: state.angular,
        input: IDLE,
        dt: DT,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [],
        fieldSizeInches: 144,
      });
    }

    expect(Math.abs(state.angular)).toBeLessThan(0.05);
  });

  it('does not ring when input ramps down like stick decay', () => {
    let pose = { x: 56, y: 40, heading: Math.PI / 2 };
    let linear = { x: 0, y: 0 };
    let angular = 0;
    let signFlips = 0;
    let prevVy = 0;

    for (let i = 0; i < 30; i++) {
      const t = 1 - i / 30;
      const next = stepVelocityDrive({
        pose,
        linear,
        angular,
        input: { forward: t, strafe: 0, turn: 0 },
        dt: DT,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [],
        fieldSizeInches: 144,
      });
      pose = next.pose;
      linear = next.linear;
      angular = next.angular;
    }

    for (let i = 0; i < 480; i++) {
      const next = stepVelocityDrive({
        pose,
        linear,
        angular,
        input: IDLE,
        dt: DT,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [],
        fieldSizeInches: 144,
      });
      if (Math.abs(prevVy) > 1 && Math.sign(prevVy) !== Math.sign(next.linear.y)) {
        signFlips++;
      }
      prevVy = next.linear.y;
      pose = next.pose;
      linear = next.linear;
      angular = next.angular;
    }

    expect(signFlips).toBeLessThanOrEqual(2);
    expect(Math.hypot(linear.x, linear.y)).toBeLessThan(0.25);
  });

  it('brakes to near-zero quickly on stick release (FTC BRAKE)', () => {
    let state = runFrames(120, { forward: 1, strafe: 0, turn: 0 });

    for (let i = 0; i < 90; i++) {
      state = stepVelocityDrive({
        pose: state.pose,
        linear: state.linear,
        angular: state.angular,
        input: IDLE,
        dt: DT,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [],
        fieldSizeInches: 144,
      });
    }

    expect(Math.hypot(state.linear.x, state.linear.y)).toBeLessThan(2);
  });

  it('held brake stops faster than release-only brake', () => {
    const speedAfter = (holdBrake: boolean, frames: number) => {
      let state = runFrames(120, { forward: 1, strafe: 0, turn: 0 });
      for (let i = 0; i < frames; i++) {
        state = stepVelocityDrive({
          pose: state.pose,
          linear: state.linear,
          angular: state.angular,
          input: { ...IDLE, brake: holdBrake },
          dt: DT,
          limits: DEFAULT_KINEMATIC_ROBOT.limits,
          footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
          barriers: [],
          fieldSizeInches: 144,
        });
      }
      return Math.hypot(state.linear.x, state.linear.y);
    };

    expect(speedAfter(true, 45)).toBeLessThan(speedAfter(false, 45));
  });
});
