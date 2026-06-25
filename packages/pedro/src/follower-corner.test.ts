import { describe, expect, it } from 'vitest';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';
import { BezierLine } from './geometry.js';
import { PedroFollower } from './follower.js';
import { PathBuilder } from './paths.js';

const LIMITS = DEFAULT_KINEMATIC_ROBOT.limits;

describe('PedroFollower sharp corners', () => {
  it('does not zero drive at high t while still far from the segment end', () => {
    const chain = new PathBuilder()
      .addPath(new BezierLine({ x: 56, y: 8, heading: Math.PI / 2 }, { x: 56, y: 36, heading: Math.PI / 2 }))
      .build();
    const follower = new PedroFollower();
    follower.setPose({ x: 56, y: 30, heading: Math.PI / 2 });
    follower.setVelocity({ x: 0, y: 12 });
    follower.followPath(chain);

    const input = follower.updateHolonomic(0.02, LIMITS);
    const mag = Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn);
    expect(mag).toBeGreaterThan(0.02);
    expect(input.brake).not.toBe(true);
  });
});
