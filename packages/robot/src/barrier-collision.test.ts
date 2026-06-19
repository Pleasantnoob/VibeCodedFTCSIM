import { describe, expect, it } from 'vitest';
import {
  buildObb,
  obbClearOfPolygon,
  obbSurfaceSamples,
  pointInPolygon,
  rotateLocalOffset,
} from './obb-sat.js';
import {
  resolveBarrierPosition,
  resolveBarrierVelocity,
  resolveMutualRobotCollisions,
  findPinnedCornerPivot,
  omegaForPivotAboutCorner,
  stepPivotAboutCorner,
} from './barrier-collision.js';
import { stepVelocityDrive } from './velocity-drive.js';
import { robotCorners } from './kinematic.js';
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

const SPAWN_POSE = { x: 56, y: 8, heading: Math.PI / 2 };

function assertObbOutsideGoal(pose: { x: number; y: number; heading: number }, goal: typeof BLUE_GOAL) {
  const obb = buildObb(pose, DEFAULT_KINEMATIC_ROBOT.footprint);
  expect(obbClearOfPolygon(obb, goal)).toBe(true);
  for (const corner of obb.corners) {
    expect(pointInPolygon(corner, goal)).toBe(false);
  }
  for (const sample of obbSurfaceSamples(obb)) {
    expect(pointInPolygon(sample, goal)).toBe(false);
  }
}

function normalizeHeadingDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

function driveIntoGoal(
  start: { x: number; y: number; heading: number },
  input: { forward: number; strafe: number; turn: number },
  goal: typeof BLUE_GOAL,
  frames: number,
  initialLinear = { x: 0, y: 0 },
) {
  let pose = { ...start };
  let linear = { ...initialLinear };
  let angular = 0;
  let maxJump = 0;
  const heading0 = pose.heading;

  for (let i = 0; i < frames; i++) {
    const prev = pose;
    const next = stepVelocityDrive({
      pose,
      linear,
      angular,
      input,
      dt: 1 / 120,
      limits: DEFAULT_KINEMATIC_ROBOT.limits,
      footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
      barriers: [goal],
      fieldSizeInches: 144,
    });
    maxJump = Math.max(maxJump, Math.hypot(next.pose.x - prev.x, next.pose.y - prev.y));
    pose = next.pose;
    linear = next.linear;
    angular = next.angular;
  }

  return { pose, maxJump, headingDelta: Math.abs(pose.heading - heading0) };
}

describe('barrier collision SAT', () => {
  it('obb edge midpoint never inside goal when parallel to wall', () => {
    const pose = { x: 14, y: 95, heading: 0 };
    const resolved = resolveBarrierPosition(pose, [BLUE_GOAL], DEFAULT_KINEMATIC_ROBOT.footprint);
    assertObbOutsideGoal(resolved, BLUE_GOAL);
  });

  it('spawn drive north does not teleport or penetrate blue goal', () => {
    const { pose, maxJump } = driveIntoGoal(
      SPAWN_POSE,
      { forward: 1, strafe: 0, turn: 0 },
      BLUE_GOAL,
      480,
    );

    expect(maxJump).toBeLessThan(2.5);
    assertObbOutsideGoal(pose, BLUE_GOAL);
  });

  it('high-speed ram from field approach does not penetrate blue goal', () => {
    const { pose, maxJump } = driveIntoGoal(
      { x: 18, y: 100, heading: Math.PI / 2 },
      { forward: 1, strafe: 0, turn: 0 },
      BLUE_GOAL,
      240,
    );

    expect(maxJump).toBeLessThan(2.5);
    assertObbOutsideGoal(pose, BLUE_GOAL);
  });

  it('vertex pivot omega matches rotation about fixed corner', () => {
    const vertex = BLUE_GOAL[0];
    const pose = { x: vertex.x + 9, y: vertex.y - 9, heading: Math.PI / 2 };
    const cornerLocal = { x: 9, y: 9 };
    const offset = rotateLocalOffset(cornerLocal, pose.heading);
    const desiredVx = 5;
    const desiredVy = 20;

    const expectedOmega =
      (desiredVx * offset.y - desiredVy * offset.x) /
      (offset.x * offset.x + offset.y * offset.y);

    const pivot = findPinnedCornerPivot(
      pose,
      DEFAULT_KINEMATIC_ROBOT.footprint,
      [BLUE_GOAL],
      desiredVx,
      desiredVy,
      0,
    );
    const obb = buildObb(pose, DEFAULT_KINEMATIC_ROBOT.footprint);
    const pivotPoint = pivot?.pivot ?? { ...obb.corners[0] };

    const omega = omegaForPivotAboutCorner(desiredVx, desiredVy, cornerLocal, pose.heading);
    expect(Math.abs(omega - expectedOmega)).toBeLessThan(0.05);
    expect(Math.abs(omega)).toBeGreaterThan(0.5);

    const stepped = stepPivotAboutCorner(pose, cornerLocal, pivotPoint, omega, 1 / 120);
    const cornerAfter = rotateLocalOffset(cornerLocal, stepped.pose.heading);
    expect(Math.hypot(
      stepped.pose.x + cornerAfter.x - pivotPoint.x,
      stepped.pose.y + cornerAfter.y - pivotPoint.y,
    )).toBeLessThan(0.001);
  });

  it('pivot integration does not spike heading per frame', () => {
    const vertex = BLUE_GOAL[0];
    let pose = { x: vertex.x + 10, y: vertex.y - 6, heading: Math.PI / 2 + 0.2 };
    let linear = { x: 0, y: 0 };
    let angular = 0;
    let maxHeadingStep = 0;

    for (let i = 0; i < 180; i++) {
      const prevHeading = pose.heading;
      const next = stepVelocityDrive({
        pose,
        linear,
        angular,
        input: { forward: 1, strafe: -0.3, turn: 0 },
        dt: 1 / 120,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [BLUE_GOAL],
        fieldSizeInches: 144,
      });
      maxHeadingStep = Math.max(
        maxHeadingStep,
        normalizeHeadingDelta(next.pose.heading, prevHeading),
      );
      pose = next.pose;
      linear = next.linear;
      angular = next.angular;
    }

    expect(maxHeadingStep).toBeLessThan(0.06);
    assertObbOutsideGoal(pose, BLUE_GOAL);
  });

  it('stationary edge pivot from rest pushes into wall', () => {
    const { headingDelta } = driveIntoGoal(
      { x: 18, y: 115, heading: Math.PI / 2 + 0.2 },
      { forward: 1, strafe: 0, turn: 0 },
      BLUE_GOAL,
      180,
    );

    expect(headingDelta).toBeGreaterThan(0.05);
  });

  it('stationary vertex pivot from rest pushes into pocket', () => {
    const vertex = BLUE_GOAL[0];
    const { headingDelta } = driveIntoGoal(
      { x: vertex.x + 10, y: vertex.y - 6, heading: Math.PI / 2 + 0.2 },
      { forward: 1, strafe: -0.3, turn: 0 },
      BLUE_GOAL,
      180,
    );

    expect(headingDelta).toBeGreaterThan(0.05);
  });

  it('push into angled wall slides smoothly without stick-slip spikes', () => {
    let pose = { x: 18, y: 115, heading: Math.PI / 2 + 0.2 };
    let linear = { x: 0, y: 0 };
    let angular = 0;
    const steps: number[] = [];

    for (let i = 0; i < 240; i++) {
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
      steps.push(Math.hypot(next.pose.x - prev.x, next.pose.y - prev.y));
      pose = next.pose;
      linear = next.linear;
      angular = next.angular;
    }

    const steady = steps.slice(80);
    expect(Math.max(...steady)).toBeLessThan(0.55);
    expect(steady.filter((s) => s > 1).length).toBe(0);
    assertObbOutsideGoal(pose, BLUE_GOAL);
  });

  it('goal pocket edge slide does not hop along barrier', () => {
    let pose = { x: 22, y: 118, heading: Math.PI / 2 };
    let linear = { x: 0, y: 0 };
    let angular = 0;
    const steps: number[] = [];

    for (let i = 0; i < 360; i++) {
      const prev = pose;
      const next = stepVelocityDrive({
        pose,
        linear,
        angular,
        input: { forward: 0.6, strafe: -1, turn: 0 },
        dt: 1 / 120,
        limits: DEFAULT_KINEMATIC_ROBOT.limits,
        footprint: DEFAULT_KINEMATIC_ROBOT.footprint,
        barriers: [BLUE_GOAL],
        fieldSizeInches: 144,
      });
      steps.push(Math.hypot(next.pose.x - prev.x, next.pose.y - prev.y));
      pose = next.pose;
      linear = next.linear;
      angular = next.angular;
    }

    const steady = steps.slice(120);
    expect(Math.max(...steady)).toBeLessThan(0.55);
    expect(steady.filter((s) => s > 1).length).toBe(0);
    assertObbOutsideGoal(pose, BLUE_GOAL);
  });

  it('corner-edge slide along wall does not phase through goal', () => {
    const { maxJump, pose } = driveIntoGoal(
      { x: 22, y: 118, heading: Math.PI / 2 },
      { forward: 0.3, strafe: -1, turn: 0 },
      BLUE_GOAL,
      240,
    );

    expect(maxJump).toBeLessThan(2.5);
    assertObbOutsideGoal(pose, BLUE_GOAL);
  });

  it('angled approach from field stops outside red goal', () => {
    const { pose, maxJump } = driveIntoGoal(
      { x: 120, y: 60, heading: 0 },
      { forward: 1, strafe: 0.35, turn: 0 },
      RED_GOAL,
      240,
    );

    expect(maxJump).toBeLessThan(2.5);
    assertObbOutsideGoal(pose, RED_GOAL);
  });
});

describe('mutual robot collisions', () => {
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;

  it('separates overlapping robots and transfers push velocity', () => {
    const pusher = {
      pose: { x: 50, y: 50, heading: 0 },
      linear: { x: 30, y: 0 },
      angular: 0,
      footprint,
    };
    const target = {
      pose: { x: 56, y: 50, heading: 0 },
      linear: { x: 0, y: 0 },
      angular: 0,
      footprint,
    };
    const startTargetX = target.pose.x;

    resolveMutualRobotCollisions([pusher, target], 12);

    expect(target.pose.x).toBeGreaterThan(startTargetX);
    expect(target.linear.x).toBeGreaterThan(0.5);
  });
});
