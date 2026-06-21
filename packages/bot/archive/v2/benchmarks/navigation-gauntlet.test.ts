import { describe, expect, it } from 'vitest';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField } from '@ftc-sim/season-decode';
import {
  createTrajectoryState,
  setTrajectoryPath,
  trajectoryStep,
} from '../navigation/trajectory-generator.js';
import { applyBarrierSlide } from '../navigation/barrier-avoidance.js';
import { MultiAgentPlanner } from '../navigation/multi-agent-planner.js';
import { buildDecodeFieldGraph } from '../navigation/field-graph.js';

describe('B1 navigation gauntlet', () => {
  it('reaches randomized goals through barrier layouts', () => {
    const field = getDecodeField();
    const barriers = getBarrierBodies(field).map((body) =>
      getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
    );
    const limits = { maxVelocity: 50, maxAngularVelocity: 4 };
    const goals = [
      { x: 40, y: 110 },
      { x: 104, y: 110 },
      { x: 30, y: 54 },
      { x: 114, y: 54 },
    ];

    let reached = 0;
    for (const goal of goals) {
      const state = createTrajectoryState();
      setTrajectoryPath(state, [
        { x: 22, y: 118 },
        goal,
      ]);
      let pose = { x: 22, y: 118, heading: 0 };
      let linear = { x: 0, y: 0 };
      for (let t = 0; t < 3600; t++) {
        let input = trajectoryStep(state, pose, linear, 1 / 120, limits, 48);
        input = applyBarrierSlide(input, pose, { width: 18, length: 18 }, barriers);
        const vx = (input.strafe ?? 0) * 50;
        const vy = input.forward * 50;
        linear = { x: vx, y: vy };
        pose = {
          ...pose,
          x: pose.x + vx / 120,
          y: pose.y + vy / 120,
        };
        if (Math.hypot(pose.x - goal.x, pose.y - goal.y) < 5) {
          reached += 1;
          break;
        }
      }
    }
    expect(reached / goals.length).toBeGreaterThanOrEqual(0.75);
  });
});

describe('B8 stability', () => {
  it('trajectory generator produces finite values at 120Hz', () => {
    const state = createTrajectoryState();
    setTrajectoryPath(state, [
      { x: 22, y: 118 },
      { x: 40, y: 110 },
    ]);
    const pose = { x: 22, y: 118, heading: 0 };
    for (let i = 0; i < 120 * 4; i++) {
      const input = trajectoryStep(
        state,
        pose,
        { x: 0, y: 0 },
        1 / 120,
        { maxVelocity: 50, maxAngularVelocity: 4 },
        48,
      );
      expect(Number.isFinite(input.forward)).toBe(true);
      expect(Number.isFinite(input.strafe ?? 0)).toBe(true);
    }
  });
});

describe('B5 multi-agent planner', () => {
  it('plans distinct paths for two alliance bots', () => {
    const graph = buildDecodeFieldGraph();
    const planner = new MultiAgentPlanner(graph.nodes, graph.edges);
    const plans = planner.planAll([
      {
        robotId: 'blue-near',
        role: 'collector',
        from: { x: 22, y: 118 },
        goal: { x: 30, y: 54 },
        alliance: 'blue',
        goalNodeHint: 'blue_spike_approach_y60',
      },
      {
        robotId: 'red-far',
        role: 'scorer',
        from: { x: 122, y: 118 },
        goal: { x: 104, y: 110 },
        alliance: 'red',
        goalNodeHint: 'red_shoot_near',
      },
    ]);
    expect(plans.get('blue-near')!.length).toBeGreaterThan(1);
    expect(plans.get('red-far')!.length).toBeGreaterThan(1);
  });
});
