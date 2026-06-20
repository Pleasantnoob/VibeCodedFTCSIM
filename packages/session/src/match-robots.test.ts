import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_NEAR_SPAWN,
  BLUE_FAR_SPAWN,
  BLUE_NEAR_SPAWN,
  CLAIMABLE_ROBOT_IDS,
  LOBBY_SLOT_ORDER,
  playerSpawnPose,
  practiceFieldRobots,
  RED_FAR_SPAWN,
  RED_NEAR_SPAWN,
  ROBOT_SLOT_LABELS,
  spawnPoseForClaimableSlot,
} from './match-robots.js';
import { DEFAULT_SIM_ROBOT_CONFIG, simRobotFootprint } from './robot-config.js';

describe('practice robot spawns', () => {
  it('red near mirrors blue near across field center', () => {
    expect(RED_NEAR_SPAWN.x).toBeCloseTo(144 - ALLIANCE_NEAR_SPAWN.blue.x, 5);
    expect(RED_NEAR_SPAWN.y).toBeCloseTo(ALLIANCE_NEAR_SPAWN.blue.y, 5);
    expect(RED_NEAR_SPAWN.heading).toBeCloseTo(Math.PI - ALLIANCE_NEAR_SPAWN.blue.heading, 5);
  });

  it('red far mirrors blue far (player spawn)', () => {
    expect(RED_FAR_SPAWN.x).toBeCloseTo(144 - BLUE_FAR_SPAWN.x, 5);
    expect(RED_FAR_SPAWN.y).toBeCloseTo(BLUE_FAR_SPAWN.y, 5);
    expect(RED_FAR_SPAWN.heading).toBeCloseTo(Math.PI - BLUE_FAR_SPAWN.heading, 5);
  });

  it('player spawns at blue far by default', () => {
    expect(playerSpawnPose()).toEqual(BLUE_FAR_SPAWN);
    expect(playerSpawnPose('blue-near')).toEqual(BLUE_NEAR_SPAWN);
    expect(playerSpawnPose('red-far')).toEqual(RED_FAR_SPAWN);
    expect(playerSpawnPose('red-near')).toEqual(RED_NEAR_SPAWN);
  });

  it('lobby slot labels match launch zones', () => {
    const footprint = simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);
    const npcs = practiceFieldRobots(footprint);
    expect(ROBOT_SLOT_LABELS.player).toBe('Blue far');
    expect(ROBOT_SLOT_LABELS['blue-near']).toBe('Blue near');
    expect(ROBOT_SLOT_LABELS['red-far']).toBe('Red far');
    expect(ROBOT_SLOT_LABELS['red-near']).toBe('Red near');
    expect(spawnPoseForClaimableSlot('player')).toEqual(BLUE_FAR_SPAWN);
    expect(spawnPoseForClaimableSlot('blue-near')).toEqual(BLUE_NEAR_SPAWN);
    expect(npcs.find((npc) => npc.id === 'blue-near')?.pose).toEqual(BLUE_NEAR_SPAWN);
    expect(CLAIMABLE_ROBOT_IDS).toEqual(['player', 'blue-near', 'red-far', 'red-near']);
    expect(LOBBY_SLOT_ORDER).toEqual(['player', 'blue-near', 'red-far', 'red-near']);
  });
});
