import { describe, expect, it } from 'vitest';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import { PLAYER_ROBOT_ID, playerSpawnPose, practiceFieldRobots } from './match-robots.js';
import { DEFAULT_SIM_ROBOT_CONFIG, simRobotFootprint } from './robot-config.js';
import { SimSession } from './sim-session.js';

async function createSession(onlyClaimedRobots: boolean): Promise<SimSession> {
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
    fixedMotif: '21',
    onlyClaimedRobots,
  });
  await session.init();
  return session;
}

describe('SimSession reset colliders', () => {
  it('re-claims only the player slot after reset when onlyClaimedRobots is true', async () => {
    const session = await createSession(true);
    session.claimRobotSlot(PLAYER_ROBOT_ID, '9999');
    session.clock.startInfinitePractice();
    session.setPendingInput({
      input: { forward: 0.4, strafe: 0, turn: 0 },
      mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
    });
    for (let i = 0; i < 60; i++) session.step();

    session.reset();
    const afterReset = session.getState();
    const player = afterReset.fieldRobots.find((robot) => robot.id === PLAYER_ROBOT_ID);
    const npcNearSpawn = afterReset.fieldRobots.find(
      (robot) => robot.id !== PLAYER_ROBOT_ID && robot.pose.x > -20 && robot.pose.y > -20,
    );

    expect(player).toBeDefined();
    expect(player!.pose.x).toBeGreaterThan(-20);
    expect(npcNearSpawn).toBeUndefined();
  }, 30_000);

  it('advances player pose again after reset and teleop resume', async () => {
    const session = await createSession(false);
    session.clock.startInfinitePractice();
    session.setPendingInput({
      input: { forward: 0.8, strafe: 0, turn: 0 },
      mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
    });
    for (let i = 0; i < 120; i++) session.step();

    session.reset();
    session.clock.startInfinitePractice();
    const resetPose = session.getState().pose;
    for (let i = 0; i < 120; i++) {
      session.setPendingInput({
        input: { forward: 0.8, strafe: 0, turn: 0 },
        mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
      });
      session.step();
    }
    const moved = session.getState().pose;

    expect(Math.hypot(moved.x - resetPose.x, moved.y - resetPose.y)).toBeGreaterThan(0.5);
  }, 30_000);
});
