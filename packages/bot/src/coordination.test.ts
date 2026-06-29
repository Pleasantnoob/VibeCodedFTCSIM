import { describe, expect, it } from 'vitest';
import { getDecodeField } from '@ftc-sim/season-decode';
import {
  allyEnRouteToGate,
  distToGateCautionArea,
  distToOpponentGate,
  pickEndgameRoles,
  pickGateAssignees,
  pickLaunchZoneForScorer,
  parkStagingTarget,
  parkDriveTarget,
  parkRouteWaypoints,
  parkApproachY,
  staggeredParkTarget,
} from './coordination.js';
import type { BotRobotSnapshot, BotSlotConfig } from './types.js';

const slots: BotSlotConfig[] = [
  { robotId: 'blue-near', enabled: true, difficulty: 'normal', runAuto: false, autoPath: null },
  { robotId: 'red-far', enabled: true, difficulty: 'normal', runAuto: false, autoPath: null },
  { robotId: 'red-near', enabled: true, difficulty: 'normal', runAuto: false, autoPath: null },
];

function rampFullWorld(robots: BotRobotSnapshot[]) {
  return {
    match: {
      phase: 'teleop' as const,
      timeElapsed: 60,
      timeRemainingInPhase: 60,
      infiniteMode: true,
      allowsDrive: true,
      controlSource: 'teleop' as const,
      running: true,
      paused: false,
    },
    robots,
    gameState: {
      gateOpen: { blue: false, red: false },
      rampOccupancy: {
        blue: ['g', 'g', 'p', 'p', 'g', 'p'],
        red: ['g', 'g', 'p', 'p', 'g', 'p'],
      },
    },
    humanInputRobotIds: new Set<string>(),
  };
}

describe('pickGateAssignees', () => {
  it('assigns only one bot per alliance when ramp is full', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 120, y: 40, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
      {
        id: 'red-near',
        alliance: 'red',
        pose: { x: 100, y: 100, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    const assignees = pickGateAssignees(
      rampFullWorld(robots) as Parameters<typeof pickGateAssignees>[0],
      slots,
      new Map(),
    );
    expect(assignees.size).toBe(1);
    expect(assignees.has('red-far')).toBe(true);
  });

  it('keeps the ally already on gate instead of picking a closer bot', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 130, y: 69, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
      {
        id: 'red-near',
        alliance: 'red',
        pose: { x: 132, y: 68, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    const allyTasks = new Map<string, 'gate'>([['red-far', 'gate']]);
    const assignees = pickGateAssignees(
      rampFullWorld(robots) as Parameters<typeof pickGateAssignees>[0],
      slots,
      allyTasks,
    );
    expect([...assignees]).toEqual(['red-far']);
  });
});

describe('distToGateCautionArea', () => {
  it('flags blue west-wall score corridor, not only the east opponent gate', () => {
    const westLaunchCorridor = distToGateCautionArea({ x: 28, y: 95 }, 'blue');
    const openField = distToGateCautionArea({ x: 72, y: 36 }, 'blue');
    expect(westLaunchCorridor).toBeLessThan(22);
    expect(openField).toBeGreaterThan(30);
    expect(westLaunchCorridor).toBeLessThan(distToOpponentGate({ x: 28, y: 95 }, 'blue'));
  });
});

describe('allyEnRouteToGate', () => {
  it('detects a teammate driving toward the gate', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'blue-near',
        alliance: 'blue',
        pose: { x: 20, y: 69, heading: 0 },
        linear: { x: -18, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    expect(allyEnRouteToGate(robots, 'blue', new Map(), 'red-far')).toBe(true);
  });
});

describe('pickLaunchZoneForScorer', () => {
  it('splits near and far between alliance partners', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 76, y: 10, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [{ id: 'a', color: 'green', slot: 0 }],
      },
      {
        id: 'red-near',
        alliance: 'red',
        pose: { x: 104, y: 115, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [{ id: 'b', color: 'green', slot: 0 }],
      },
    ];
    const allyLaunchZones = new Map<string, 'near' | 'far'>([['red-far', 'far']]);
    expect(pickLaunchZoneForScorer('red-near', robots, 'red', allyLaunchZones)).toBe('near');
  });
});

describe('pickEndgameRoles', () => {
  it('does not assign endgame roles until 5 seconds left', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 80, y: 80, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [{ id: 'a', color: 'green', slot: 0 }],
      },
      {
        id: 'red-near',
        alliance: 'red',
        pose: { x: 50, y: 50, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    const roles = pickEndgameRoles(
      {
        ...rampFullWorld(robots),
        field: getDecodeField(),
        match: {
          phase: 'teleop',
          timeElapsed: 102,
          timeRemainingInPhase: 8,
          infiniteMode: false,
          allowsDrive: true,
          controlSource: 'teleop',
          running: true,
          paused: false,
        },
      } as Parameters<typeof pickEndgameRoles>[0],
      slots,
      new Map([['red-far', 'score']]),
    );
    expect(roles.size).toBe(0);
  });

  it('assigns park roles for both bots at 5 seconds left', () => {
    const robots: BotRobotSnapshot[] = [
      {
        id: 'red-far',
        alliance: 'red',
        pose: { x: 80, y: 80, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [
          { id: 'a', color: 'green', slot: 0 },
          { id: 'b', color: 'purple', slot: 1 },
        ],
      },
      {
        id: 'red-near',
        alliance: 'red',
        pose: { x: 50, y: 50, heading: 0 },
        linear: { x: 0, y: 0 },
        angular: 0,
        stored: [],
      },
    ];
    const roles = pickEndgameRoles(
      {
        ...rampFullWorld(robots),
        field: getDecodeField(),
        match: {
          phase: 'teleop',
          timeElapsed: 115,
          timeRemainingInPhase: 5,
          infiniteMode: false,
          allowsDrive: true,
          controlSource: 'teleop',
          running: true,
          paused: false,
        },
      } as Parameters<typeof pickEndgameRoles>[0],
      slots,
      new Map([['red-far', 'score']]),
    );
    expect(roles.get('red-far')).toBe('parker');
    expect(roles.get('red-near')).toBe('parker');
  });
});

describe('parkRouteWaypoints', () => {
  it('splits blue-near and red-far staging lanes', () => {
    const field = getDecodeField();
    const bluePark = staggeredParkTarget(field, 'blue', 'blue-near');
    const redPark = staggeredParkTarget(field, 'red', 'red-far');
    const blueLane = parkRouteWaypoints(bluePark.target, 'blue', 'blue-near')[0]!;
    const redLane = parkRouteWaypoints(redPark.target, 'red', 'red-far')[0]!;
    expect(blueLane.y).not.toBe(redLane.y);
    expect(Math.abs(blueLane.x - redLane.x)).toBeGreaterThan(30);
  });

  it('advances through lane then approach before base', () => {
    const field = getDecodeField();
    const bluePark = staggeredParkTarget(field, 'blue', 'blue-near');
    const lane = parkDriveTarget(bluePark.target, { x: 20, y: 20 }, 'blue', 'blue-near');
    expect(lane.y).toBeGreaterThan(50);
    const approach = parkDriveTarget(
      bluePark.target,
      { x: 85, y: 58 },
      'blue',
      'blue-near',
    );
    expect(approach.y).toBe(50);
  });

  it('gives each bot a distinct approach row', () => {
    expect(parkApproachY('blue-near')).toBeGreaterThan(parkApproachY('red-far'));
    expect(parkApproachY('blue-far')).toBeGreaterThan(parkApproachY('red-near'));
  });
});

describe('staggeredParkTarget', () => {
  it('offsets park points for two alliance bots', () => {
    const field = getDecodeField();
    const far = staggeredParkTarget(field, 'red', 'red-far');
    const near = staggeredParkTarget(field, 'red', 'red-near');
    expect(far.target.x).not.toBe(near.target.x);
  });
});
