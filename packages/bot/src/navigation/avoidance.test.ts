import { describe, expect, it } from 'vitest';
import { getDecodeField } from '@ftc-sim/season-decode';
import { applyBotAvoidance, detectOpponentInSecretTunnel } from './avoidance.js';
import type { BotRobotSnapshot } from '../types.js';

describe('detectOpponentInSecretTunnel', () => {
  const field = getDecodeField();

  it('detects blue player in blue secret tunnel for red bots', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'player',
        alliance: 'blue',
        pose: { x: 140, y: 45, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    expect(detectOpponentInSecretTunnel(robots, 'red', field)).toBe(true);
  });

  it('ignores red bots in blue secret tunnel', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 140, y: 45, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    expect(detectOpponentInSecretTunnel(robots, 'red', field)).toBe(false);
  });
});

describe('opponent gate avoidance', () => {
  const field = getDecodeField();

  it('deflects red bots away from the blue gate before penalty range', () => {
    const drivingTowardGate = { forward: 0, strafe: 0.75, turn: 0 };
    const pose = { x: 45, y: 69, heading: 0 };
    const avoided = applyBotAvoidance(
      drivingTowardGate,
      pose,
      [],
      'red-far',
      'red',
      field,
      'score',
      false,
    );
    expect(avoided.strafe ?? 0).toBeLessThan(0.75);
  });

  it('still allows assigned gate bots through opponent gate repulsion', () => {
    const input = { forward: 0, strafe: 0.6, turn: 0 };
    const pose = { x: 45, y: 69, heading: 0 };
    const avoided = applyBotAvoidance(
      input,
      pose,
      [],
      'red-far',
      'red',
      field,
      'gate',
      false,
      'field',
      undefined,
      new Set(['red-far']),
    );
    expect(avoided.strafe ?? 0).toBe(0.6);
  });
});
