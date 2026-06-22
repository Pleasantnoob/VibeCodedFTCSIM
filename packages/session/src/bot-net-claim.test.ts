import { describe, expect, it } from 'vitest';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { defaultPracticeBotSlots } from '@ftc-sim/bot';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import {
  playerSpawnPose,
  practiceFieldRobots,
  SimSession,
  simRobotFootprint,
  DEFAULT_SIM_ROBOT_CONFIG,
} from './index.js';

describe('multiplayer bot slot claims', () => {
  it('activates unclaimed practice slots when bots fill empty seats', async () => {
    const field = getDecodeField();
    const footprint = simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);
    const barriers = getBarrierBodies(field).map((body) => ({
      id: body.id,
      label: body.label ?? body.id,
      vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
    }));

    const session = new SimSession({
      field,
      alliance: 'blue',
      artifactStaging: getMatchArtifactStaging(),
      barriers,
      startPose: playerSpawnPose(),
      robotConfig: DEFAULT_SIM_ROBOT_CONFIG,
      practiceRobots: practiceFieldRobots(footprint),
      onlyClaimedRobots: true,
    });
    await session.init();

    const slots = defaultPracticeBotSlots('normal').map((slot) => ({ ...slot, enabled: true }));
    session.setBotSlots(slots);

    const state = session.getState();
    expect(state.fieldRobots.map((robot) => robot.id).sort()).toEqual(
      ['blue-near', 'red-far', 'red-near'].sort(),
    );

    session.claimRobotSlot('blue-near', '9999');
    session.setBotSlots(
      slots.map((slot) => ({
        ...slot,
        enabled: slot.robotId !== 'blue-near',
      })),
    );

    const afterHuman = session.getState();
    expect(afterHuman.fieldRobots.some((robot) => robot.id === 'blue-near')).toBe(true);
    expect(afterHuman.fieldRobots.some((robot) => robot.id === 'red-far')).toBe(true);
    expect(afterHuman.fieldRobots.some((robot) => robot.id === 'red-near')).toBe(true);
  });
});
