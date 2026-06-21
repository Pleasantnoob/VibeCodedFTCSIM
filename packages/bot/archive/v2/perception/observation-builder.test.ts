import { describe, expect, it } from 'vitest';
import { getDecodeField } from '@ftc-sim/season-decode';
import { buildObservation } from './observation-builder.js';
import type { BotWorldSnapshot } from '../types.js';

describe('observation builder', () => {
  it('builds observation with alliance splits', () => {
    const field = getDecodeField();
    const world: BotWorldSnapshot = {
      tickIndex: 1,
      match: {
        phase: 'teleop',
        timeElapsed: 10,
        timeRemainingInPhase: 110,
        running: true,
        paused: false,
        allowsDrive: true,
        controlSource: 'human',
        infiniteMode: false,
      },
      field,
      robots: [
        {
          id: 'player',
          alliance: 'blue',
          pose: { x: 56, y: 8, heading: 0 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [],
        },
        {
          id: 'red-far',
          alliance: 'red',
          pose: { x: 88, y: 8, heading: 0 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [],
        },
      ],
      artifacts: [],
      gameState: null,
      barriers: [],
      footprint: { width: 18, length: 18 },
      limits: {
        maxVelocity: 50,
        maxAngularVelocity: 4,
      },
      maxAcceleration: 48,
      maxAngularAcceleration: 18,
      humanInputRobotIds: new Set(['player']),
      botSlots: [],
    };

    const obs = buildObservation(world, 'player');
    expect(obs).not.toBeNull();
    expect(obs!.allies).toHaveLength(0);
    expect(obs!.opponents).toHaveLength(1);
    expect(obs!.field.zones.length).toBeGreaterThan(0);
  });
});
