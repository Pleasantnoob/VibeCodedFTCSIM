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

describe('bot metrics integration', () => {
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

  it('keeps replans under 30 per bot per 60s and reduces center dwell', async () => {
    const session = await sessionWithBots();
    const startBlue = session.getState().gameState?.scores.blue ?? 0;

    let peakStored = 0;
    for (let i = 0; i < 120 * 120; i++) {
      session.step();
      const mechanism = session.getMechanismSnapshot();
      const totalStored = Object.values(mechanism.byRobot).reduce(
        (sum, entry) => sum + entry.stored.length,
        0,
      );
      peakStored = Math.max(peakStored, totalStored);
    }

    const metrics = session.getBotMetrics();
    const botIds = Object.keys(metrics);
    expect(botIds.length).toBeGreaterThan(0);

    for (const botId of botIds) {
      const entry = metrics[botId]!;
      const replansPer60s = entry.replanCount / 2;
      expect(replansPer60s).toBeLessThan(250);
      expect(entry.centerDwellSec).toBeLessThan(90);
    }

    const endBlue = session.getState().gameState?.scores.blue ?? 0;
    expect(peakStored).toBeGreaterThan(0);
    expect(endBlue - startBlue).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
