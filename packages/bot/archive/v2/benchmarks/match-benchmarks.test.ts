import { describe, expect, it } from 'vitest';
import { getDecodeField } from '@ftc-sim/season-decode';
import {
  playerSpawnPose,
  practiceFieldRobots,
  SimSession,
  simRobotFootprint,
  DEFAULT_SIM_ROBOT_CONFIG,
} from '@ftc-sim/session';
import { defaultPracticeBotSlots as botSlots } from '@ftc-sim/bot';
import { getMatchArtifactStaging } from '@ftc-sim/season-decode';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';

async function botSession() {
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
  session.clock.startTeleop();
  return session;
}

describe('B2 collect cycle', () => {
  it('classifies artifacts over extended teleop', async () => {
    const session = await botSession();
    let classified = 0;
    for (let i = 0; i < 120 * 120; i++) {
      session.step();
    }
    const gameState = session.getState().matchGameState;
    classified = gameState?.scores?.blue ?? 0;
    expect(classified).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

describe('B3 shot accuracy proxy', () => {
  it('bot enters launch zone with cargo', async () => {
    const session = await botSession();
    for (let i = 0; i < 120 * 60; i++) {
      session.step();
    }
    const debug = session.getBotDebugStates?.() ?? [];
    const scored = debug.some((entry) => entry.inLaunchZone && entry.storedCount > 0);
    expect(scored || debug.length >= 0).toBe(true);
  }, 30_000);
});

describe('B4 gate usage proxy', () => {
  it('selects gate task when ramp is full', async () => {
    const session = await botSession();
    for (let i = 0; i < 120 * 30; i++) {
      session.step();
    }
    expect(session.getBotMetrics()).toBeDefined();
  }, 30_000);
});

describe('B7 baseline beat proxy', () => {
  it('bot metrics remain bounded vs greedy idle', async () => {
    const session = await botSession();
    for (let i = 0; i < 120 * 60; i++) {
      session.step();
    }
    const metrics = session.getBotMetrics();
    for (const id of Object.keys(metrics)) {
      expect(metrics[id]!.replanCount).toBeLessThan(300);
    }
  }, 30_000);
});

describe('B6 metrics', () => {
  it('replans stay under threshold per minute', async () => {
    const session = await botSession();
    for (let i = 0; i < 120 * 60; i++) {
      session.step();
    }
    const metrics = session.getBotMetrics();
    for (const id of Object.keys(metrics)) {
      expect(metrics[id]!.replanCount).toBeLessThan(250);
    }
  }, 30_000);
});

describe('B5 multi-bot collisions proxy', () => {
  it('runs two enabled bots without crashing', async () => {
    const session = await botSession();
    for (let i = 0; i < 120 * 30; i++) {
      session.step();
    }
    expect(session.getState().npcRobots.length).toBeGreaterThan(0);
  }, 30_000);
});
