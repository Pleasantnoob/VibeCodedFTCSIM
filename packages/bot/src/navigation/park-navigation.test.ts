import { describe, expect, it } from 'vitest';
import type { BotRobotSnapshot } from '../types.js';
import {
  allyBlocksParkApproach,
  fieldDriveTowardPark,
  parkPassDetourTarget,
  parkPassVerticalSide,
} from './park-navigation.js';

describe('park navigation', () => {
  it('assigns opposite over/under pass sides for head-on pairs', () => {
    expect(parkPassVerticalSide('blue-near', 'red-near')).toBe(1);
    expect(parkPassVerticalSide('red-near', 'blue-near')).toBe(-1);
  });

  it('pass detour targets split over and under', () => {
    const pose = { x: 70, y: 44, heading: 0 };
    const target = { x: 33, y: 33 };
    const blocker: BotRobotSnapshot = {
      id: 'blue-near',
      alliance: 'blue',
      pose: { x: 68, y: 44, heading: Math.PI / 2 },
      linear: { x: 0, y: 0 },
      angular: 0,
      stored: [],
    };
    const over = parkPassDetourTarget(pose, target, blocker, 1);
    const under = parkPassDetourTarget(pose, target, blocker, -1);
    expect(over.y - under.y).toBeGreaterThan(20);
  });

  it('drives through head-on pass with forward commit', () => {
    const pose = { x: 72, y: 50, heading: -Math.PI / 2 };
    const target = { x: 33, y: 33 };
    const robots: BotRobotSnapshot[] = [
      {
        id: 'blue-near',
        alliance: 'blue',
        pose: { x: 54, y: 42, heading: Math.PI / 2 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    const tasks = new Map<string, 'park'>([['blue-near', 'park']]);
    const drive = fieldDriveTowardPark(pose, target, robots, 'red-near', 'red', {
      robotTasks: tasks,
    });
    expect(Math.hypot(drive.forward ?? 0, drive.strafe ?? 0)).toBeGreaterThan(0.45);
  });

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
    const withoutBlocker = fieldDriveTowardPark(pose, target, [], 'red-near', 'red');
    const withBlocker = fieldDriveTowardPark(pose, target, robots, 'red-near', 'red');
    expect(Math.abs((withBlocker.strafe ?? 0) - (withoutBlocker.strafe ?? 0))).toBeGreaterThan(0.35);
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
      pose: { x: 56, y: 38, heading: 0 },
      linear: { x: 0, y: 0 },
      angular: 0,
      stored: [],
    };
    const target = { x: 33, y: 33 };
    expect(
      allyBlocksParkApproach(self, target, [self, ally], new Map([['red-far', 'park']])),
    ).toBe(true);
  });

  it('does not yield when ally is closer but not in the corridor', () => {
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
      pose: { x: 40, y: 70, heading: 0 },
      linear: { x: 0, y: 0 },
      angular: 0,
      stored: [],
    };
    const target = { x: 33, y: 33 };
    expect(
      allyBlocksParkApproach(self, target, [self, ally], new Map([['red-far', 'park']])),
    ).toBe(false);
  });
});
