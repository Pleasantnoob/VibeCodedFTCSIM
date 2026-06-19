import { describe, expect, it } from 'vitest';
import { DEFAULT_KINEMATIC_ROBOT, stepVelocityDrive } from '@ftc-sim/robot';
import { BezierLine } from './geometry.js';
import { PedroFollower } from './follower.js';
import { parsePedroJson } from './path-io.js';
import { parseVisualizerPp } from './pp-io.js';
import { PathBuilder, getPathStartPose } from './paths.js';

const LIMITS = DEFAULT_KINEMATIC_ROBOT.limits;
const FOOTPRINT = DEFAULT_KINEMATIC_ROBOT.footprint;

describe('PedroFollower', () => {
  it('produces drive input when offset from path start', () => {
    const chain = new PathBuilder()
      .addPath(new BezierLine({ x: 0, y: 0, heading: 0 }, { x: 48, y: 0, heading: 0 }))
      .build();
    const follower = new PedroFollower();
    follower.setPose({ x: 0, y: 5, heading: 0 });
    follower.setVelocity({ x: 0, y: 0 });
    follower.followPath(chain);

    const input = follower.updateHolonomic(0.02, LIMITS);
    const mag = Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn);
    expect(mag).toBeGreaterThan(0.05);
  });

  it('getErrors reports translational offset', () => {
    const chain = new PathBuilder()
      .addPath(new BezierLine({ x: 10, y: 10, heading: 0 }, { x: 40, y: 10, heading: 0 }))
      .build();
    const follower = new PedroFollower();
    follower.setPose({ x: 10, y: 13, heading: 0 });
    follower.followPath(chain);
    expect(follower.getErrors().translational).toBeCloseTo(3, 1);
  });

  it('progress increases along a short straight path', () => {
    const chain = new PathBuilder()
      .addPath(new BezierLine({ x: 56, y: 8, heading: Math.PI / 2 }, { x: 56, y: 36, heading: Math.PI / 2 }))
      .build();
    const start = getPathStartPose(chain);
    const follower = new PedroFollower();
    follower.setPose(start);
    follower.setVelocity({ x: 0, y: 0 });
    follower.followPath(chain);

    let state = { pose: start, linear: { x: 0, y: 0 }, angular: 0 };
    const dt = 0.02;

    for (let i = 0; i < 500; i++) {
      follower.setPose(state.pose);
      follower.setVelocity(state.linear);
      const input = follower.updateHolonomic(dt, LIMITS);
      state = stepVelocityDrive({
        ...state,
        input,
        dt,
        limits: LIMITS,
        footprint: FOOTPRINT,
        barriers: [],
        fieldSizeInches: 144,
        driveFrame: 'robot',
      });
    }

    expect(state.pose.y).toBeGreaterThan(start.y + 5);
    expect(follower.getProgress().completion).toBeGreaterThan(0.5);
  });
});

describe('follower-drive integration', () => {
  it('example path simulation stays below max speed', () => {
    const chain = parsePedroJson({
      paths: [
        {
          type: 'BezierLine',
          startPoint: { x: 56, y: 8 },
          endPoint: { x: 56, y: 40 },
          headingInterpolation: {
            mode: 'linear',
            startHeading: Math.PI / 2,
            endHeading: Math.PI / 2,
            endTime: 0.8,
          },
        },
      ],
    });
    const start = getPathStartPose(chain);
    const follower = new PedroFollower();
    follower.setPose(start);
    follower.followPath(chain);

    let state = { pose: start, linear: { x: 0, y: 0 }, angular: 0 };
    let maxSpeed = 0;
    const dt = 0.02;

    for (let i = 0; i < 3000; i++) {
      follower.setPose(state.pose);
      follower.setVelocity(state.linear);
      const input = follower.updateHolonomic(dt, LIMITS);
      state = stepVelocityDrive({
        ...state,
        input,
        dt,
        limits: LIMITS,
        footprint: FOOTPRINT,
        barriers: [],
        fieldSizeInches: 144,
        driveFrame: 'robot',
      });
      maxSpeed = Math.max(maxSpeed, Math.hypot(state.linear.x, state.linear.y));
    }

    expect(maxSpeed).toBeLessThanOrEqual(LIMITS.maxVelocity * 1.05);
  });

  it('decode PP export follows north then west with goal barriers', () => {
    const chain = parseVisualizerPp({
      version: '1.2.1',
      startPoint: { x: 56, y: 8, heading: 'linear', startDeg: 90, endDeg: 180 },
      lines: [
        {
          endPoint: { x: 56, y: 36, heading: 'linear', startDeg: 90, endDeg: 180 },
          controlPoints: [],
        },
        {
          endPoint: { x: 12, y: 36, heading: 'tangential' },
          controlPoints: [],
        },
      ],
    });
    const start = getPathStartPose(chain);
    const barriers = [
      [
        { x: 6, y: 119 },
        { x: 25, y: 144 },
        { x: 0, y: 144 },
        { x: 0, y: 70 },
        { x: 7, y: 70 },
      ],
    ];
    const follower = new PedroFollower();
    follower.setPose(start);
    follower.followPath(chain);

    let state = { pose: start, linear: { x: 0, y: 0 }, angular: 0 };
    const dt = 0.02;

    for (let i = 0; i < 4000; i++) {
      follower.setPose(state.pose);
      follower.setVelocity(state.linear);
      const input = follower.updateHolonomic(dt, LIMITS);
      state = stepVelocityDrive({
        ...state,
        input,
        dt,
        limits: LIMITS,
        footprint: FOOTPRINT,
        barriers,
        fieldSizeInches: 144,
        driveFrame: 'robot',
      });
    }

    expect(state.pose.y).toBeGreaterThan(30);
    expect(state.pose.x).toBeLessThan(20);
    expect(follower.getErrors().translational).toBeLessThan(8);
  });
});
