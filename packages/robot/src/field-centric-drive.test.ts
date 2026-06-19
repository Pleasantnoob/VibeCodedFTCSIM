import { describe, expect, it } from 'vitest';
import { INCHES_TO_METERS } from '@ftc-sim/field';
import { computeFieldCentricDriveForces } from './field-centric-drive.js';
import { DEFAULT_KINEMATIC_ROBOT } from './types.js';

const IDLE = { forward: 0, strafe: 0, turn: 0 };
const DT = 1 / 120;
const MASS = 10;

function stepVelocity(
  velocity: { x: number; y: number; omega: number },
  pose: { x: number; y: number; heading: number },
  input: { forward: number; strafe: number; turn: number },
): { x: number; y: number; omega: number } {
  const forces = computeFieldCentricDriveForces({
    mass: MASS,
    input,
    bodyPose: pose,
    bodyVelocity: { x: velocity.x, y: velocity.y },
    bodyAngular: velocity.omega,
    limits: DEFAULT_KINEMATIC_ROBOT.limits,
    footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
    fieldSizeInches: 144,
  });
  const ax = forces.fx / (MASS * INCHES_TO_METERS);
  const ay = forces.fy / (MASS * INCHES_TO_METERS);
  const inertia = (MASS * (DEFAULT_KINEMATIC_ROBOT.footprint.width * INCHES_TO_METERS) ** 2) / 6;
  const alpha = forces.torque / inertia;
  return {
    x: velocity.x + ax * DT,
    y: velocity.y + ay * DT,
    omega: velocity.omega + alpha * DT,
  };
}

describe('field-centric drive', () => {
  it('coasts linear and angular velocity to zero with no input', () => {
    const pose = { x: 56, y: 40, heading: Math.PI / 2 };
    let velocity = { x: 12, y: -8, omega: 1.2 };

    for (let i = 0; i < 600; i++) {
      velocity = stepVelocity(velocity, pose, IDLE);
    }

    expect(Math.hypot(velocity.x, velocity.y)).toBeLessThan(0.15);
    expect(Math.abs(velocity.omega)).toBeLessThan(0.05);
  });

  it('applies braking torque when only rotating with no input', () => {
    const pose = { x: 56, y: 40, heading: Math.PI / 2 };
    let omega = 2;

    for (let i = 0; i < 400; i++) {
      const next = stepVelocity({ x: 0, y: 0, omega }, pose, IDLE);
      omega = next.omega;
    }

    expect(Math.abs(omega)).toBeLessThan(0.05);
  });

  it('does not oscillate after releasing forward input', () => {
    const pose = { x: 56, y: 40, heading: Math.PI / 2 };
    let velocity = { x: 0, y: 0, omega: 0 };
    const driveNorth = { forward: 1, strafe: 0, turn: 0 };

    for (let i = 0; i < 120; i++) {
      velocity = stepVelocity(velocity, pose, driveNorth);
    }

    let signFlips = 0;
    let prevVy = velocity.y;
    for (let i = 0; i < 480; i++) {
      velocity = stepVelocity(velocity, pose, IDLE);
      if (Math.abs(prevVy) > 1 && Math.sign(prevVy) !== Math.sign(velocity.y)) {
        signFlips++;
      }
      prevVy = velocity.y;
    }

    expect(signFlips).toBeLessThanOrEqual(1);
    expect(Math.abs(velocity.y)).toBeLessThan(0.2);
  });
});
