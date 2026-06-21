import { describe, expect, it } from 'vitest';
import { getDecodeField } from '@ftc-sim/season-decode';
import {
  isCollectibleArtifact,
  pickCollectTarget,
  scanCollectibleArtifacts,
} from './artifacts.js';
import {
  createCollectorState,
  tickSimpleCollector,
} from './simple-collector.js';
import type { BotSlotConfig, BotWorldSnapshot } from './types.js';

const field = getDecodeField();

function baseWorld(overrides: Partial<BotWorldSnapshot> = {}): BotWorldSnapshot {
  return {
    tickIndex: 1,
    match: {
      phase: 'teleop',
      timeElapsed: 5,
      timeRemainingInPhase: 100,
      infiniteMode: true,
      allowsDrive: true,
      controlSource: 'teleop',
      running: true,
      paused: false,
      ...((overrides.match as object) ?? {}),
    } as BotWorldSnapshot['match'],
    field: overrides.field ?? field,
    robots: overrides.robots ?? [
      {
        id: 'blue-near',
        alliance: 'blue',
        pose: { x: 30, y: 30, heading: Math.PI / 2 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ],
    artifacts: overrides.artifacts ?? [
      {
        id: 'art_near',
        color: 'green',
        phase: 'onField',
        pose: { x: 40, y: 30, heading: 0 },
        source: 'blue_spike_y60',
      },
      {
        id: 'art_far',
        color: 'purple',
        phase: 'onField',
        pose: { x: 90, y: 90, heading: 0 },
        source: 'red_spike_y60',
      },
    ],
    gameState: null,
    barriers: [],
    footprint: { width: 18, length: 18 },
    limits: { maxVelocity: 48, maxAngularVelocity: 4 } as BotWorldSnapshot['limits'],
    robotMass: 40,
    maxAcceleration: 48,
    maxAngularAcceleration: 18,
    humanInputRobotIds: new Set(),
    botSlots: [{ robotId: 'blue-near', enabled: true, difficulty: 'normal', runAuto: false, autoPath: null }],
    ...overrides,
  };
}

const slot: BotSlotConfig = {
  robotId: 'blue-near',
  enabled: true,
  difficulty: 'normal',
  runAuto: false,
  autoPath: null,
};

describe('artifact filter', () => {
  it('ignores opponent spike artifacts', () => {
    expect(
      isCollectibleArtifact(
        {
          id: 'x',
          color: 'green',
          phase: 'onField',
          pose: { x: 90, y: 60, heading: 0 },
          source: 'red_spike_y60',
        },
        'blue',
      ),
    ).toBe(false);
  });

  it('still collects alliance spike balls that drifted past midline', () => {
    expect(
      isCollectibleArtifact(
        {
          id: 'x',
          color: 'green',
          phase: 'onField',
          pose: { x: 90, y: 60, heading: 0 },
          source: 'blue_spike_y60',
        },
        'blue',
      ),
    ).toBe(true);
  });

  it('collects missed preload shots that still carry reserve source tags', () => {
    expect(
      isCollectibleArtifact(
        {
          id: 'missed',
          color: 'green',
          phase: 'onField',
          pose: { x: 40, y: 60, heading: 0 },
          source: 'blue_human_player_reserve',
        },
        'blue',
      ),
    ).toBe(true);
    expect(
      isCollectibleArtifact(
        {
          id: 'reserve',
          color: 'purple',
          phase: 'humanPlayerReserve',
          pose: { x: 0, y: 0, heading: 0 },
          source: 'blue_human_player_reserve',
        },
        'blue',
      ),
    ).toBe(false);
  });

  it('collects loading-zone balls knocked onto the field', () => {
    expect(
      isCollectibleArtifact(
        {
          id: 'station',
          color: 'green',
          phase: 'onField',
          pose: { x: 12, y: 18, heading: 0 },
          source: 'blue_human_player_station',
        },
        'blue',
      ),
    ).toBe(true);
  });

  it('skips alliance artifacts parked on the opponent gate', () => {
    expect(
      isCollectibleArtifact(
        {
          id: 'gate_ball',
          color: 'purple',
          phase: 'onField',
          pose: { x: 12, y: 70, heading: 0 },
          source: 'red_spike_y60',
        },
        'red',
      ),
    ).toBe(false);
    expect(
      isCollectibleArtifact(
        {
          id: 'safe_ball',
          color: 'purple',
          phase: 'onField',
          pose: { x: 120, y: 60, heading: 0 },
          source: 'red_spike_y60',
        },
        'red',
      ),
    ).toBe(true);
  });

  it('prefers artifact clusters over a lone scattered ball', () => {
    const robot = {
      id: 'blue-near',
      alliance: 'blue' as const,
      pose: { x: 30, y: 30, heading: 0 },
      linear: { x: 0, y: 0 },
      angular: 0,
      stored: [],
    };
    const artifacts = [
      {
        id: 'loner',
        color: 'green' as const,
        phase: 'onField',
        pose: { x: 32, y: 32, heading: 0 },
        source: 'blue_spike_y36',
      },
      {
        id: 'c1',
        color: 'purple' as const,
        phase: 'onField',
        pose: { x: 24, y: 84, heading: 0 },
        source: 'blue_spike_y84',
      },
      {
        id: 'c2',
        color: 'green' as const,
        phase: 'onField',
        pose: { x: 29, y: 84, heading: 0 },
        source: 'blue_spike_y84',
      },
      {
        id: 'c3',
        color: 'purple' as const,
        phase: 'onField',
        pose: { x: 34, y: 84, heading: 0 },
        source: 'blue_spike_y84',
      },
    ];
    const pick = pickCollectTarget(robot, artifacts, [robot]);
    expect(pick.pick?.artifact.id).toMatch(/^c/);
    expect(pick.pick?.cluster).toBeGreaterThanOrEqual(3);
  });
});

describe('simple collector', () => {
  it('targets alliance spike artifacts only', () => {
    const state = createCollectorState();
    const result = tickSimpleCollector(baseWorld(), slot, state);

    expect(result.debug.task).toBe('collect');
    expect(result.debug.artifactId).toBe('art_near');
    expect(result.sample.mechanism.command.intake).toBe(1);
  });

  it('turns while moving toward artifact when not facing', () => {
    const state = createCollectorState();
    const world = baseWorld({
      robots: [
        {
          id: 'blue-near',
          alliance: 'blue',
          pose: { x: 30, y: 30, heading: 0 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [],
        },
      ],
      artifacts: [
        {
          id: 'art_north',
          color: 'green',
          phase: 'onField',
          pose: { x: 30, y: 50, heading: 0 },
          source: 'blue_spike_y84',
        },
      ],
    });
    const result = tickSimpleCollector(world, slot, state);

    expect(result.sample.input.turn).not.toBe(0);
    expect(result.sample.input.forward).toBeGreaterThan(0);
  });

  it('heads to launch zone when full', () => {
    const state = createCollectorState();
    const world = baseWorld({
      robots: [
        {
          id: 'blue-near',
          alliance: 'blue',
          pose: { x: 50, y: 50, heading: 0 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [
            { id: 'a1', color: 'green', slot: 0 },
            { id: 'a2', color: 'purple', slot: 1 },
            { id: 'a3', color: 'green', slot: 2 },
          ],
        },
      ],
    });
    const result = tickSimpleCollector(world, slot, state);

    expect(result.debug.task).toBe('score');
    const driveMag = Math.hypot(
      result.sample.input.forward ?? 0,
      result.sample.input.strafe ?? 0,
    );
    expect(driveMag).toBeGreaterThan(0.1);
    expect(result.sample.driveFrame).toBe('field');
  });

  it('does not brake while driving to launch from across the field', () => {
    const state = createCollectorState();
    const world = baseWorld({
      robots: [
        {
          id: 'blue-near',
          alliance: 'blue',
          pose: { x: 50, y: 50, heading: 1.9 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [
            { id: 'a1', color: 'green', slot: 0 },
            { id: 'a2', color: 'purple', slot: 1 },
            { id: 'a3', color: 'green', slot: 2 },
          ],
        },
      ],
    });
    const result = tickSimpleCollector(world, slot, state);

    expect(result.debug.task).toBe('score');
    expect(result.sample.input.brake).not.toBe(true);
    const driveMag = Math.hypot(
      result.sample.input.forward ?? 0,
      result.sample.input.strafe ?? 0,
    );
    expect(driveMag).toBeGreaterThan(0.45);
  });

  it('forces park under 5 seconds left', () => {
    const state = createCollectorState();
    const world = baseWorld({
      match: {
        phase: 'teleop',
        timeElapsed: 115,
        timeRemainingInPhase: 4,
        infiniteMode: false,
        allowsDrive: true,
        controlSource: 'teleop',
        running: true,
        paused: false,
      } as BotWorldSnapshot['match'],
    });
    const result = tickSimpleCollector(world, slot, state);
    expect(result.debug.task).toBe('park');
  });

  it('returns to collect after emptying storage', () => {
    const state = createCollectorState();
    state.commitScoring = true;
    state.lastStoredCount = 1;
    const world = baseWorld({
      robots: [
        {
          id: 'blue-near',
          alliance: 'blue',
          pose: { x: 30, y: 30, heading: 0 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [],
        },
      ],
    });
    const result = tickSimpleCollector(world, slot, state);

    expect(result.debug.task).toBe('collect');
    expect(state.commitScoring).toBe(false);
  });

  it('uses field-centric drive frame', () => {
    const state = createCollectorState();
    const result = tickSimpleCollector(baseWorld(), slot, state);
    expect(result.sample.driveFrame).toBe('field');
  });

  it('parks toward alliance base zone centroid', () => {
    const state = createCollectorState();
    const world = baseWorld({
      match: {
        phase: 'teleop',
        timeElapsed: 115,
        timeRemainingInPhase: 4,
        infiniteMode: false,
        allowsDrive: true,
        controlSource: 'teleop',
        running: true,
        paused: false,
      } as BotWorldSnapshot['match'],
      robots: [
        {
          id: 'blue-near',
          alliance: 'blue',
          pose: { x: 50, y: 80, heading: 0 },
          linear: { x: 0, y: 0 },
          angular: 0,
          stored: [],
        },
      ],
    });
    const result = tickSimpleCollector(world, slot, state);
    expect(result.debug.task).toBe('park');
    expect(result.debug.target?.y).toBeGreaterThan(20);
    expect(result.debug.target?.y).toBeLessThan(50);
    expect(result.debug.target?.x).toBeGreaterThan(90);
  });

  it('logs scan breakdown when no artifacts found', () => {
    const state = createCollectorState();
    const world = baseWorld({ artifacts: [] });
    const result = tickSimpleCollector(world, slot, state);
    expect(result.logLines.some((line) => line.startsWith('WAIT'))).toBe(true);
    expect(scanCollectibleArtifacts(world.robots[0]!, [], world.robots).collectible).toBe(0);
  });
});
