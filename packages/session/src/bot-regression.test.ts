import { describe, expect, it } from 'vitest';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import {
  hashSimState,
  playerSpawnPose,
  practiceFieldRobots,
  SimSession,
  simRobotFootprint,
  DEFAULT_SIM_ROBOT_CONFIG,
} from '@ftc-sim/session';

function baseConfig() {
  const field = getDecodeField();
  const footprint = simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);
  const barriers = getBarrierBodies(field).map((body) => ({
    id: body.id,
    label: body.label ?? body.id,
    vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
  }));
  return {
    field,
    alliance: 'blue' as const,
    artifactStaging: getMatchArtifactStaging(),
    barriers,
    startPose: playerSpawnPose(),
    robotConfig: DEFAULT_SIM_ROBOT_CONFIG,
    practiceRobots: practiceFieldRobots(footprint),
    fixedMotif: '21' as const,
  };
}

describe('bot regression', () => {
  it('disabled bots do not change sim hash vs no bot config', async () => {
    const sessionA = new SimSession(baseConfig());
    await sessionA.init();
    sessionA.clock.startInfinitePractice();

    const sessionB = new SimSession({
      ...baseConfig(),
      botSlots: [
        { robotId: 'blue-near', enabled: false, difficulty: 'normal', runAuto: false, autoPath: null },
        { robotId: 'red-far', enabled: false, difficulty: 'normal', runAuto: false, autoPath: null },
        { robotId: 'red-near', enabled: false, difficulty: 'normal', runAuto: false, autoPath: null },
      ],
    });
    await sessionB.init();
    sessionB.clock.startInfinitePractice();

    for (let i = 0; i < 600; i++) {
      sessionA.step();
      sessionB.step();
    }

    expect(hashSimState(sessionA)).toBe(hashSimState(sessionB));
  }, 30_000);
});
