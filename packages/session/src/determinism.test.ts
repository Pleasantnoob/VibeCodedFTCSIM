import { describe, expect, it } from 'vitest';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import { playerSpawnPose, practiceFieldRobots } from './match-robots.js';
import { DEFAULT_SIM_ROBOT_CONFIG, simRobotFootprint } from './robot-config.js';
import { hashSimState, SimSession } from './sim-session.js';

describe('sim determinism', () => {
  it('produces identical state hash after 240 ticks with fixed input', async () => {
    const field = getDecodeField();
    const footprint = simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);
    const barriers = getBarrierBodies(field).map((body) => ({
      id: body.id,
      label: body.label ?? body.id,
      vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
    }));

    const baseConfig = {
      field,
      alliance: 'blue' as const,
      artifactStaging: getMatchArtifactStaging(),
      barriers,
      startPose: playerSpawnPose(),
      robotConfig: DEFAULT_SIM_ROBOT_CONFIG,
      practiceRobots: practiceFieldRobots(footprint),
      fixedMotif: '21' as const,
    };

    const run = async () => {
      const session = new SimSession(baseConfig);
      await session.init();
      session.clock.startInfinitePractice();
      for (let i = 0; i < 240; i++) {
        session.setPendingInput({
          input: { forward: 0.6, strafe: 0, turn: 0.1 },
          mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
        });
        session.step();
      }
      return hashSimState(session);
    };

    const hashA = await run();
    const hashB = await run();
    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe('0');
  }, 30_000);
});
