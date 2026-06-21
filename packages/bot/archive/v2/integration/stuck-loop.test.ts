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

describe('bot stuck loop guard', () => {
  async function sessionWithBots() {
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
    session.clock.startTeleop();
    return session;
  }

  it('keeps replans under 30 per bot in 30s teleop', async () => {
    const session = await sessionWithBots();
    for (let i = 0; i < 30 * 120; i++) {
      session.step();
    }
    const metrics = session.getBotMetrics();
    for (const [robotId, entry] of Object.entries(metrics)) {
      expect(entry.replanCount, `${robotId} replan storm`).toBeLessThan(30);
    }
  }, 60_000);

  it('each bot moves at least 20 inches in 10s teleop', async () => {
    const session = await sessionWithBots();
    const starts = new Map(
      session.getState().npcRobots.map((npc) => [npc.id, { ...npc.pose }]),
    );
    for (let i = 0; i < 10 * 120; i++) {
      session.step();
    }
    for (const npc of session.getState().npcRobots) {
      const start = starts.get(npc.id)!;
      const dist = Math.hypot(npc.pose.x - start.x, npc.pose.y - start.y);
      expect(dist, `${npc.id} should drive`).toBeGreaterThan(20);
    }
  }, 60_000);
});
