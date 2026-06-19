import { describe, expect, it } from 'vitest';
import { DEFAULT_KINEMATIC_ROBOT, stepVelocityDrive } from '@ftc-sim/robot';
import { AutoSequenceRunner } from './auto-sequence.js';
import { BezierLine } from './geometry.js';
import { parseVisualizerAutoSequence } from './pp-io.js';
import { PathBuilder, getPathStartPose } from './paths.js';

const LIMITS = DEFAULT_KINEMATIC_ROBOT.limits;
const FOOTPRINT = DEFAULT_KINEMATIC_ROBOT.footprint;
const dt = 1 / 120;

function straightChain(from: { x: number; y: number; heading: number }, to: { x: number; y: number; heading: number }) {
  const builder = new PathBuilder();
  builder.addPath(new BezierLine(from, to));
  return builder.build();
}

describe('AutoSequenceRunner integration', () => {
  it('stays running across segment transitions (north then west)', () => {
    const auto = parseVisualizerAutoSequence({
      version: '1.2.1',
      startPoint: { x: 56, y: 8, heading: 'linear', startDeg: 90, endDeg: 180 },
      lines: [
        {
          id: 'north',
          endPoint: { x: 56, y: 36, heading: 'linear', startDeg: 90, endDeg: 180 },
          controlPoints: [],
        },
        {
          id: 'west',
          endPoint: { x: 12, y: 36, heading: 'tangential' },
          controlPoints: [],
        },
      ],
      sequence: [
        { kind: 'path', lineId: 'north' },
        { kind: 'path', lineId: 'west' },
      ],
    });

    const runner = new AutoSequenceRunner();
    let state = { pose: auto.startPose, linear: { x: 0, y: 0 }, angular: 0 };
    runner.setPose(state.pose);
    runner.start(auto.steps);

    let enteredWest = false;

    for (let i = 0; i < 8000 && runner.isRunning(); i++) {
      runner.setPose(state.pose);
      runner.setVelocity(state.linear);
      const input = runner.updateHolonomic(dt, LIMITS);
      state = stepVelocityDrive({
        ...state,
        input,
        dt,
        limits: LIMITS,
        footprint: FOOTPRINT,
        barriers: [],
        fieldSizeInches: 144,
        driveFrame: 'robot',
        maxAcceleration: 48,
        maxAngularAcceleration: 18,
      });

      const target = runner.getTargetPose();
      if (target && target.x < 50) {
        enteredWest = true;
      }
    }

    expect(state.pose.y).toBeGreaterThan(30);
    expect(enteredWest).toBe(true);
    expect(state.pose.x).toBeLessThan(25);
    expect(runner.isRunning()).toBe(false);
  });

  it('does not drop isRunning when a segment ends mid-tick', () => {
    const chain = straightChain(
      { x: 0, y: 0, heading: Math.PI / 2 },
      { x: 0, y: 5, heading: Math.PI / 2 },
    );
    const runner = new AutoSequenceRunner();
    runner.setPose({ x: 0, y: 4.95, heading: Math.PI / 2 });
    runner.setVelocity({ x: 0, y: 2 });
    runner.start([
      { kind: 'path', chain },
      {
        kind: 'path',
        chain: straightChain(
          { x: 0, y: 5, heading: Math.PI },
          { x: -10, y: 5, heading: Math.PI },
        ),
      },
    ]);

    runner.updateHolonomic(dt, LIMITS);
    expect(runner.isRunning()).toBe(true);
  });
});
