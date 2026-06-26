import { describe, expect, it } from 'vitest';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';
import { BezierLine } from './geometry.js';
import { PedroFollower, PEDRO_SEGMENT_END_THRESHOLD } from './follower.js';
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

  it('does not overshot-brake when closestT is high but center is still far from the end', () => {
    const chain = new PathBuilder()
      .addPath(
        new BezierLine(
          { x: 57, y: 12, heading: Math.PI / 2 },
          { x: 21, y: 36, heading: Math.PI },
        ),
      )
      .build();
    const follower = new PedroFollower();
    follower.setPose({ x: 50, y: 28, heading: Math.PI / 2 });
    follower.setVelocity({ x: -8, y: 4 });
    follower.followPath(chain);

    const input = follower.updateHolonomic(0.02, LIMITS);
    const end = chain.paths[0]!.curve.getEnd();
    const dist = Math.hypot(end.x - 50, end.y - 28);
    expect(dist).toBeGreaterThan(PEDRO_SEGMENT_END_THRESHOLD);
    const mag = Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn);
    expect(mag).toBeGreaterThan(0.02);
    expect(input.brake).not.toBe(true);
  });

  it('turns in place on zero-length heading-only segments', () => {
    const chain = new PathBuilder()
      .addPath(
        new BezierLine(
          { x: 57, y: 12, heading: Math.PI / 2 },
          { x: 57, y: 12, heading: (110 * Math.PI) / 180 },
        ),
      )
      .build();
    const follower = new PedroFollower();
    follower.setPose({ x: 57, y: 12, heading: Math.PI / 2 });
    follower.followPath(chain);

    const input = follower.updateHolonomic(0.02, LIMITS);
    expect(Math.abs(input.turn)).toBeGreaterThan(0.01);
    expect(follower.isBusy()).toBe(true);
  });
});
