import { describe, expect, it } from 'vitest';
import type { BotRobotSnapshot } from '../types.js';
import { allyBlocksParkApproach, fieldDriveTowardPark } from './park-navigation.js';

describe('park navigation', () => {
  it('detours laterally when an ally blocks the corridor', () => {
    const pose = { x: 60, y: 40, heading: Math.PI / 2 };
    const target = { x: 33, y: 33 };
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 48, y: 38, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    const input = fieldDriveTowardPark(pose, target, robots, 'red-near', 'red');
    expect(Math.abs(input.strafe ?? 0)).toBeGreaterThan(0.2);
  });

  it('yields when an ally is closer to the same park target', () => {
    const self: BotRobotSnapshot = {
      id: 'red-near',
      alliance: 'red',
      pose: { x: 60, y: 40, heading: 0 },
      linear: { x: 0, y: 0 },
      angular: 0,
      stored: [],
    };
    const ally: BotRobotSnapshot = {
      id: 'red-far',
      alliance: 'red',
      pose: { x: 40, y: 34, heading: 0 },
      linear: { x: 0, y: 0 },
      angular: 0,
      stored: [],
    };
    const target = { x: 33, y: 33 };
    expect(
      allyBlocksParkApproach(self, target, [self, ally], new Map([['red-far', 'park']])),
    ).toBe(true);
  });
});
