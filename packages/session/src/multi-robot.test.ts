import { describe, expect, it } from 'vitest';
import type { Pose } from '@ftc-sim/field';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import {
  playerSpawnPose,
  practiceFieldRobots,
  RED_FAR_SPAWN,
  RED_NEAR_SPAWN,
  type MatchRobotLayout,
} from './match-robots.js';
import { DEFAULT_SIM_ROBOT_CONFIG, simRobotFootprint } from './robot-config.js';
import { SimSession } from './sim-session.js';

describe('multi-robot session', () => {
  const footprint = () => simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);

  const baseConfig = () => {
    const field = getDecodeField();
    const fp = footprint();
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
      practiceRobots: practiceFieldRobots(fp),
      fixedMotif: '21' as const,
    };
  };

  /** Positions robots facing human-player artifact stacks for reliable intake tests. */
  const intakeTestConfig = (startPose: Pose, npcLayouts: MatchRobotLayout[]) => {
    const field = getDecodeField();
    const fp = footprint();
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
      startPose,
      robotConfig: DEFAULT_SIM_ROBOT_CONFIG,
      practiceRobots: npcLayouts,
      fixedMotif: '21' as const,
    };
  };

  it('host player keeps drive when another slot sends idle input', async () => {
    const session = new SimSession(baseConfig());
    await session.init();
    session.clock.startInfinitePractice();

    const startPose = session.getState().pose;

    for (let i = 0; i < 120; i++) {
      session.applyInputFrame({
        seq: i,
        robotId: 'blue-near',
        drive: { forward: 0, strafe: 0, turn: 0, brake: true },
        mechanism: {},
        shootEdge: false,
      });
      session.applyInputFrame({
        seq: i,
        robotId: 'player',
        drive: { forward: 0.8, strafe: 0, turn: 0 },
        mechanism: { intake: 1 },
        shootEdge: false,
      });
      session.step();
    }

    const endPose = session.getState().pose;
    expect(Math.hypot(endPose.x - startPose.x, endPose.y - startPose.y)).toBeGreaterThan(0.5);
  }, 30_000);

  it('each robot keeps its own stored artifacts', async () => {
    const fp = footprint();
    const session = new SimSession(
      intakeTestConfig(
        { x: 14, y: 10, heading: Math.PI },
        [
          {
            id: 'blue-near',
            alliance: 'blue',
            teamNumber: '-3',
            pose: { x: 130, y: 10, heading: 0 },
            width: fp.width,
            length: fp.length,
          },
          {
            id: 'red-far',
            alliance: 'red',
            teamNumber: '-2',
            pose: RED_FAR_SPAWN,
            width: fp.width,
            length: fp.length,
          },
          {
            id: 'red-near',
            alliance: 'red',
            teamNumber: '-1',
            pose: RED_NEAR_SPAWN,
            width: fp.width,
            length: fp.length,
          },
        ],
      ),
    );
    await session.init();
    session.clock.startInfinitePractice();

    for (let i = 0; i < 240; i++) {
      session.applyInputFrame({
        seq: i,
        robotId: 'player',
        drive: { forward: 0.6, strafe: 0, turn: 0 },
        mechanism: { intake: 1 },
        shootEdge: false,
      });
      session.applyInputFrame({
        seq: i,
        robotId: 'blue-near',
        drive: { forward: 0.6, strafe: 0, turn: 0 },
        mechanism: { intake: 1 },
        shootEdge: false,
      });
      session.step();
    }

    const snapshot = session.getState();
    const held = snapshot.liveArtifacts.filter((artifact) => artifact.phase === 'held');
    expect(held.length).toBeGreaterThanOrEqual(2);

    const playerPose = snapshot.pose;
    const blueNear = snapshot.npcRobots.find((npc) => npc.id === 'blue-near')!.pose;
    for (const artifact of held) {
      const nearPlayer = Math.hypot(artifact.pose.x - playerPose.x, artifact.pose.y - playerPose.y);
      const nearBlueNear = Math.hypot(artifact.pose.x - blueNear.x, artifact.pose.y - blueNear.y);
      expect(Math.min(nearPlayer, nearBlueNear)).toBeLessThan(20);
    }
  }, 30_000);

  it('shooting on one robot does not empty another robot hopper', async () => {
    const fp = footprint();
    const session = new SimSession(
      intakeTestConfig(
        { x: 14, y: 10, heading: Math.PI },
        [
          {
            id: 'blue-near',
            alliance: 'blue',
            teamNumber: '-3',
            pose: { x: 130, y: 10, heading: 0 },
            width: fp.width,
            length: fp.length,
          },
          {
            id: 'red-far',
            alliance: 'red',
            teamNumber: '-2',
            pose: RED_FAR_SPAWN,
            width: fp.width,
            length: fp.length,
          },
          {
            id: 'red-near',
            alliance: 'red',
            teamNumber: '-1',
            pose: RED_NEAR_SPAWN,
            width: fp.width,
            length: fp.length,
          },
        ],
      ),
    );
    await session.init();
    session.clock.startInfinitePractice();

    for (let i = 0; i < 240; i++) {
      session.applyInputFrame({
        seq: i,
        robotId: 'player',
        drive: { forward: 0.6, strafe: 0, turn: 0 },
        mechanism: { intake: 1 },
        shootEdge: false,
      });
      session.applyInputFrame({
        seq: i,
        robotId: 'blue-near',
        drive: { forward: 0.6, strafe: 0, turn: 0 },
        mechanism: { intake: 1 },
        shootEdge: false,
      });
      session.step();
    }

    const beforeSnapshot = session.getState();
    const beforeShoot = beforeSnapshot.liveArtifacts.filter((a) => a.phase === 'held');
    expect(beforeShoot.length).toBeGreaterThanOrEqual(2);

    const blueNearPose = beforeSnapshot.npcRobots.find((npc) => npc.id === 'blue-near')!.pose;
    const heldNearBlueNear = (artifacts: typeof beforeShoot) =>
      artifacts.filter(
        (a) => Math.hypot(a.pose.x - blueNearPose.x, a.pose.y - blueNearPose.y) < 20,
      ).length;
    const blueNearHeldBefore = heldNearBlueNear(beforeShoot);

    session.applyInputFrame({
      seq: 240,
      robotId: 'player',
      drive: { forward: 0, strafe: 0, turn: 0 },
      mechanism: { shoot: true },
      shootEdge: true,
    });
    session.step();

    const afterSnapshot = session.getState();
    const afterShoot = afterSnapshot.liveArtifacts.filter((a) => a.phase === 'held');
    expect(heldNearBlueNear(afterShoot)).toBe(blueNearHeldBefore);
    expect(afterShoot.length).toBeGreaterThanOrEqual(beforeShoot.length - 1);
  }, 30_000);
});
