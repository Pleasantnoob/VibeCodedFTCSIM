import { describe, expect, it } from 'vitest';
import { BotController } from '../controller/bot-controller.js';
import { BlackboardRegistry } from '../cognition/blackboard.js';
import type { BotWorldSnapshot } from '../types.js';
import { getDecodeField } from '@ftc-sim/season-decode';

function minimalWorld(overrides: Partial<BotWorldSnapshot> = {}): BotWorldSnapshot {
  return {
    tickIndex: 0,
    match: {
      phase: 'teleop',
      timeElapsed: 0,
      timeRemainingInPhase: 120,
      running: true,
      paused: false,
      allowsDrive: true,
      controlSource: 'human',
      infiniteMode: true,
    },
    field: getDecodeField(),
    robots: [
      {
        id: 'blue-near',
        alliance: 'blue',
        pose: { x: 22, y: 124, heading: Math.PI },
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
    humanInputRobotIds: new Set<string>(),
    botSlots: [{ robotId: 'blue-near', enabled: true, difficulty: 'normal' }],
    ...overrides,
  };
}

describe('BotController', () => {
  it('produces bounded holonomic input', () => {
    const boards = new BlackboardRegistry();
    const controller = new BotController('blue-near', boards, 'normal');
    controller.setEnabled(true);

    let sample = controller.tick(minimalWorld(), 1 / 120);
    for (let i = 0; i < 120; i++) {
      sample = controller.tick(minimalWorld({ tickIndex: i }), 1 / 120) ?? sample;
    }

    expect(sample).not.toBeNull();
    expect(Math.abs(sample!.input.forward)).toBeLessThanOrEqual(1.01);
    expect(Math.abs(sample!.input.strafe ?? 0)).toBeLessThanOrEqual(1.01);
    expect(Math.abs(sample!.input.turn ?? 0)).toBeLessThanOrEqual(1.01);
  });
});
