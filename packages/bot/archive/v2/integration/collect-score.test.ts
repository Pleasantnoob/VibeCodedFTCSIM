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

describe('bot collect and score integration', () => {
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

  it('bots increase alliance score within 120s teleop', async () => {
    const session = await sessionWithBots();
    const startBlue = session.getState().matchGameState?.byAlliance.blue.score.total ?? 0;

    for (let i = 0; i < 120 * 120; i++) {
      session.step();
    }

    const endBlue = session.getState().matchGameState?.byAlliance.blue.score.total ?? 0;
    const endRed = session.getState().matchGameState?.byAlliance.red.score.total ?? 0;
    expect(endBlue + endRed).toBeGreaterThan(startBlue);
  }, 120_000);
});
