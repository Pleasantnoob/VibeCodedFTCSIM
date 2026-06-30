import { describe, expect, it } from 'vitest';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import {
  playerSpawnPose,
  practiceFieldRobots,
  SimSession,
  simRobotFootprint,
  DEFAULT_SIM_ROBOT_CONFIG,
} from '@ftc-sim/session';
import { defaultPracticeBotSlots } from '@ftc-sim/bot';

describe('practice NPC physics bodies', () => {
  it('collect bots spawn colliders and drive toward artifacts in teleop', async () => {
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
      botSlots: defaultPracticeBotSlots('normal'),
    });
    await session.init();
    session.clock.startTeleop();

    const start = session.getState().npcRobots[0]!.pose;
    for (let i = 0; i < 120; i++) {
      session.step();
    }
    const end = session.getState().npcRobots[0]!.pose;
    const moved = Math.hypot(end.x - start.x, end.y - start.y);
    expect(session.getState().npcRobots.length).toBe(practiceFieldRobots(footprint).length);
    expect(moved).toBeGreaterThan(5);
  }, 30_000);
});
