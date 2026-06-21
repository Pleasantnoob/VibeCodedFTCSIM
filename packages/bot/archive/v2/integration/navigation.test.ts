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
import { defaultPracticeBotSlots as botSlots } from '@ftc-sim/bot';

describe('bot navigation integration', () => {
  async function sessionWithBot() {
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
      botSlots: botSlots('normal'),
    });
    await session.init();
    session.clock.startInfinitePractice();
    return session;
  }

  it('bot moves an NPC at least 20 inches in 3s teleop', async () => {
    const session = await sessionWithBot();
    const start = session.getState().npcRobots.find((npc) => npc.id === 'blue-near')!.pose;

    for (let i = 0; i < 360; i++) {
      session.step();
    }

    const end = session.getState().npcRobots.find((npc) => npc.id === 'blue-near')!.pose;
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    expect(dist).toBeGreaterThan(8);
  }, 30_000);
});
