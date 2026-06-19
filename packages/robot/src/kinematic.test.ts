import { describe, expect, it } from 'vitest';
import {
  clampHolonomicVelocityToField,
  clampPoseToField,
  holonomicToWorldVelocity,
  integrateKinematicRobot,
  robotCorners,
} from './kinematic.js';
import { pointInPolygon, resolveBarrierCollisions } from './barrier-collision.js';
import { stepVelocityDrive } from './velocity-drive.js';
import { DEFAULT_KINEMATIC_ROBOT } from './types.js';

const BLUE_GOAL = [
  { x: 6, y: 119 },
  { x: 25, y: 144 },
  { x: 0, y: 144 },
  { x: 0, y: 70 },
  { x: 7, y: 70 },
];

const RED_GOAL = [
  { x: 144, y: 70 },
  { x: 144, y: 144 },
  { x: 120, y: 144 },
  { x: 138, y: 119 },
  { x: 138, y: 70 },
];

describe('kinematic robot', () => {
  it('moves north in field-centric mode regardless of heading', () => {
    const vel = holonomicToWorldVelocity(
      { forward: 1, strafe: 0, turn: 0 },
      Math.PI,
      DEFAULT_KINEMATIC_ROBOT.limits,
      'field',
    );
    expect(vel.vx).toBeCloseTo(0);
    expect(vel.vy).toBeCloseTo(50);
  });

  it('moves east in field-centric mode when strafing right', () => {
    const vel = holonomicToWorldVelocity(
      { forward: 0, strafe: -1, turn: 0 },
      0,
      DEFAULT_KINEMATIC_ROBOT.limits,
      'field',
    );
    expect(vel.vx).toBeCloseTo(50);
    expect(vel.vy).toBeCloseTo(0);
  });

  it('keeps all corners inside the field', () => {
    const pose = clampPoseToField(
      { x: 1, y: 1, heading: Math.PI / 4 },
      DEFAULT_KINEMATIC_ROBOT.footprint,
    );
    const corners = robotCorners(pose, DEFAULT_KINEMATIC_ROBOT.footprint);
    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(0);
      expect(corner.y).toBeGreaterThanOrEqual(0);
      expect(corner.x).toBeLessThanOrEqual(144);
      expect(corner.y).toBeLessThanOrEqual(144);
    }
  });

  it('zeros southward target velocity at the south edge', () => {
    const pose = { x: 10, y: 9.5, heading: Math.PI / 2 };
    const { vx, vy } = clampHolonomicVelocityToField(pose, DEFAULT_KINEMATIC_ROBOT.footprint, 0, -50);
    expect(vx).toBeCloseTo(0);
    expect(vy).toBe(0);
  });

  it('allows northward target velocity at the south edge', () => {
    const pose = { x: 10, y: 9.5, heading: Math.PI / 2 };
    const { vy } = clampHolonomicVelocityToField(pose, DEFAULT_KINEMATIC_ROBOT.footprint, 0, 50);
    expect(vy).toBe(50);
  });

  it('stops at field bounds when driving south', () => {
    const pose = integrateKinematicRobot(
      { x: 10, y: 10, heading: Math.PI / 2 },
      { forward: -1, strafe: 0, turn: 0 },
      2,
      DEFAULT_KINEMATIC_ROBOT.limits,
      [],
      DEFAULT_KINEMATIC_ROBOT.footprint,
      'field',
    );
    const corners = robotCorners(pose, DEFAULT_KINEMATIC_ROBOT.footprint);
    expect(Math.min(...corners.map((corner) => corner.y))).toBeGreaterThanOrEqual(0);
  });

  it('pushes robot away from concave goal when overlapping', () => {
    const overlapping = { x: 14, y: 95, heading: 0 };
    const resolved = resolveBarrierCollisions(overlapping, [BLUE_GOAL], DEFAULT_KINEMATIC_ROBOT.footprint);
    const corners = robotCorners(resolved, DEFAULT_KINEMATIC_ROBOT.footprint);
    for (const corner of corners) {
      expect(pointInPolygon(corner, BLUE_GOAL)).toBe(false);
    }
    expect(Math.hypot(resolved.x - overlapping.x, resolved.y - overlapping.y)).toBeGreaterThan(0.5);
  });

  it('does not teleport when driving from spawn into blue goal wall', () => {
    const { pose, maxJump } = (() => {
      let pose = { x: 56, y: 8, heading: Math.PI / 2 };
      let linear = { x: 0, y: 0 };
      let angular = 0;
      let maxJump = 0;

      for (let i = 0; i < 480; i++) {
        const prev = pose;
        const next = stepVelocityDrive({
          pose,
          linear,
          angular,
          input: { forward: 1, strafe: 0, turn: 0 },
          dt: 1 / 120,
          limits: DEFAULT_KINEMATIC_ROBOT.limits,
          footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
          barriers: [BLUE_GOAL],
          fieldSizeInches: 144,
        });
        maxJump = Math.max(maxJump, Math.hypot(next.pose.x - prev.x, next.pose.y - prev.y));
        pose = next.pose;
        linear = next.linear;
        angular = next.angular;
      }

      return { pose, maxJump };
    })();

    expect(maxJump).toBeLessThan(2.5);
    const corners = robotCorners(pose, DEFAULT_KINEMATIC_ROBOT.footprint);
    for (const corner of corners) {
      expect(pointInPolygon(corner, BLUE_GOAL)).toBe(false);
    }
  });

  it('pivots when corner contacts goal vertex at an angle', () => {
    const vertex = BLUE_GOAL[0];
    let pose = { x: vertex.x + 10, y: vertex.y - 8, heading: Math.PI / 2 };
    let linear = { x: -6, y: 28 };
    let angular = 0;
    const heading0 = pose.heading;

    for (let i = 0; i < 120; i++) {
      const next = stepVelocityDrive({
        pose,
        linear,
        angular,
        input: { forward: 1, strafe: -0.35, turn: 0 },
        dt: 1 / 120,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [BLUE_GOAL],
        fieldSizeInches: 144,
      });
      pose = next.pose;
      linear = next.linear;
      angular = next.angular;
    }

    expect(Math.abs(pose.heading - heading0)).toBeGreaterThan(0.03);
    const corners = robotCorners(pose, DEFAULT_KINEMATIC_ROBOT.footprint);
    for (const corner of corners) {
      expect(pointInPolygon(corner, BLUE_GOAL)).toBe(false);
    }
  });

  it('pushes toward nearest edge not centroid on concave pocket', () => {
    const pocket = { x: 10, y: 125 };
    const resolved = resolveBarrierCollisions(
      { x: pocket.x, y: pocket.y, heading: 0 },
      [BLUE_GOAL],
      DEFAULT_KINEMATIC_ROBOT.footprint,
    );
    const corners = robotCorners(resolved, DEFAULT_KINEMATIC_ROBOT.footprint);
    for (const corner of corners) {
      expect(pointInPolygon(corner, BLUE_GOAL)).toBe(false);
    }
  });

  it('resolves red goal collisions from field approach', () => {
    const approach = { x: 120, y: 90, heading: 0 };
    const resolved = resolveBarrierCollisions(approach, [RED_GOAL], DEFAULT_KINEMATIC_ROBOT.footprint);
    const corners = robotCorners(resolved, DEFAULT_KINEMATIC_ROBOT.footprint);
    for (const corner of corners) {
      expect(pointInPolygon(corner, RED_GOAL)).toBe(false);
    }
  });
});
