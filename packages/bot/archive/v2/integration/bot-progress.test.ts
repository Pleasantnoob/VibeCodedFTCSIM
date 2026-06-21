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

describe('bot progress diagnostics', () => {
  it('bots collect cargo within 45s teleop', async () => {
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

    let peakStored = 0;
    const startPoses = new Map(
      session.getState().npcRobots.map((npc) => [npc.id, { ...npc.pose }]),
    );
    for (let i = 0; i < 45 * 120; i++) {
      session.step();
      const mechanism = session.getMechanismSnapshot();
      const totalStored = Object.values(mechanism.byRobot).reduce(
        (sum, entry) => sum + entry.stored.length,
        0,
      );
      peakStored = Math.max(peakStored, totalStored);
    }

    for (const npc of session.getState().npcRobots) {
      const start = startPoses.get(npc.id)!;
      const dist = Math.hypot(npc.pose.x - start.x, npc.pose.y - start.y);
      expect(dist).toBeGreaterThan(20);
    }

    const metrics = session.getBotMetrics();
    for (const [robotId, entry] of Object.entries(metrics)) {
      expect(entry.replanCount, `${robotId} replans`).toBeLessThan(40);
    }

    expect(peakStored).toBeGreaterThan(0);
  }, 90_000);
});
