import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@ftc-sim/field';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import { DecodeRulesEngine } from '@ftc-sim/game-decode';
import { ArtifactSimulation, type PhysicsAdapter } from './artifact-simulation.js';
import {
  artifactTouchesFrontEdge,
  detectArtifactStuckInStructure,
  heldArtifactOffset,
  localToWorld,
  planShot,
  rampSlotPositions,
  rampSouthExitPose,
  GATE_RELEASE_INTERVAL_S,
  RAMP_ROLL_MIN_S,
  robotForwardUnit,
  robotFootprintCorners,
  robotInGateZone,
  robotInLaunchZone,
} from './geometry.js';
import type { SimArtifactState } from './types.js';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';

function mockPhysics(): PhysicsAdapter {
  return {
    getArtifactPose: () => ({ x: 0, y: 0, heading: 0 }),
    getArtifactVelocity: () => ({ x: 0, y: 0 }),
    setArtifactPose: () => {},
    setArtifactVelocity: () => {},
    setArtifactEnabled: () => {},
    isArtifactColliderEnabled: () => true,
    isArtifactColliderActive: () => true,
    ensureArtifactColliderForPhase: () => {},
    parkArtifactBody: () => {},
    activateArtifactBody: () => {},
    activateStationArtifactBody: () => {},
    syncRobotCollider: () => {},
    step: () => {},
  };
}

describe('gate proximity', () => {
  const field = getDecodeField();
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;
  const blueGate = field.zones.find((z) => z.id === 'blue_gate')!;

  it('detects robot footprint overlapping gate zone', () => {
    const insidePose = { x: 0, y: 69, heading: 0 };
    expect(robotInGateZone(insidePose, footprint, blueGate.polygon)).toBe(true);
  });

  it('rejects robot far from gate zone', () => {
    const outsidePose = { x: 9, y: 40, heading: 0 };
    expect(robotInGateZone(outsidePose, footprint, blueGate.polygon)).toBe(false);
  });
});

describe('human player reserve visibility', () => {
  it('hides reserve balls until teleop', () => {
    const field = getDecodeField();
    const sim = new ArtifactSimulation(
      field,
      new DecodeRulesEngine({ field, alliance: 'blue' }),
      'blue',
    );
    sim.init(getMatchArtifactStaging());
    const physics = mockPhysics();

    sim.syncHumanPlayerReserve('setup', physics);
    const hidden = sim.getRenderArtifacts().filter((a) => a.source?.endsWith('_human_player_reserve'));
    expect(hidden).toHaveLength(0);

    sim.syncHumanPlayerReserve('teleop', physics);
    const visible = sim.getRenderArtifacts().filter((a) => a.source?.endsWith('_human_player_reserve'));
    expect(visible).toHaveLength(12);
  });

  it('preload consumes reserve balls, not loading-zone station', () => {
    const field = getDecodeField();
    const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;
    const sim = new ArtifactSimulation(
      field,
      new DecodeRulesEngine({ field, alliance: 'blue' }),
      'blue',
    );
    sim.init(getMatchArtifactStaging());
    const physics = mockPhysics();
    const pose = { x: 20, y: 10, heading: 0 };

    sim.applyPlayerPreload('player', 'blue', pose, footprint, physics, () => 0.5);

    const station = [...sim.getRenderArtifacts()].filter(
      (a) => a.source === 'blue_human_player_station',
    );
    expect(station).toHaveLength(3);
    expect(sim.getStoredCount('player')).toBe(3);

    const reserveLeft = sim.getSnapshot().artifacts.filter(
      (a) => a.phase === 'humanPlayerReserve' && a.source === 'blue_human_player_reserve',
    );
    expect(reserveLeft).toHaveLength(3);
  });
});

describe('human player station during auto', () => {
  it('intakes loading-zone station balls during auto', () => {
    const field = getDecodeField();
    const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;
    const sim = new ArtifactSimulation(
      field,
      new DecodeRulesEngine({ field, alliance: 'blue' }),
      'blue',
    );
    sim.init(getMatchArtifactStaging());
    const physics = mockPhysics();
    sim.syncHumanPlayerStation('auto', physics);

    const station = [...sim.getSnapshot().artifacts].find(
      (a) => a.source === 'blue_human_player_station',
    );
    expect(station).toBeDefined();

    const robotPose = { x: station!.pose.x, y: station!.pose.y - footprint.length / 2 - 1, heading: Math.PI / 2 };
    sim.applyCommand('player', { intake: 1, shoot: 0 }, false, false);
    sim.tickRobots(
      1 / 120,
      [{ robotId: 'player', pose: robotPose, linear: { x: 0, y: 0 }, alliance: 'blue', shootEdge: false, gateEdge: false, shootHeld: false }],
      footprint,
      physics,
      'auto',
    );

    expect(sim.getStoredCount('player')).toBeGreaterThan(0);
  });
});

describe('robot-artifact collision bypass', () => {
  const field = getDecodeField();
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;
  const pose = { x: 72, y: 40, heading: Math.PI / 2 };

  it('requires intake on to bypass collisions (auto and teleop)', () => {
    const sim = new ArtifactSimulation(field, new DecodeRulesEngine({ field, alliance: 'blue' }), 'blue');
    expect(sim.shouldBypassRobotArtifactCollision('player', pose, footprint, 'auto')).toBe(false);
    expect(sim.shouldBypassRobotArtifactCollision('player', pose, footprint, 'teleop')).toBe(false);
    sim.applyCommand('player', { intake: 1 }, false, false);
    expect(sim.shouldBypassRobotArtifactCollision('player', pose, footprint, 'auto')).toBe(true);
    expect(sim.shouldBypassRobotArtifactCollision('player', pose, footprint, 'teleop')).toBe(true);
  });
});

describe('front-edge intake', () => {
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;
  const pose = { x: 72, y: 40, heading: Math.PI / 2 };

  it('accepts artifact centered on front edge', () => {
    const frontY = pose.y + footprint.length / 2 + 2.5;
    expect(
      artifactTouchesFrontEdge({ x: pose.x, y: frontY }, pose, footprint),
    ).toBe(true);
  });

  it('rejects artifact at robot side', () => {
    const sideX = pose.x + footprint.width / 2 + 3;
    expect(
      artifactTouchesFrontEdge({ x: sideX, y: pose.y }, pose, footprint),
    ).toBe(false);
  });
});

describe('held artifact slots', () => {
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;
  const pose = { x: 72, y: 40, heading: Math.PI / 2 };

  it('fills back → center → front along robot forward axis', () => {
    const back = localToWorld(heldArtifactOffset(0, footprint), pose);
    const center = localToWorld(heldArtifactOffset(1, footprint), pose);
    const front = localToWorld(heldArtifactOffset(2, footprint), pose);
    expect(back.y).toBeLessThan(center.y);
    expect(center.y).toBeLessThan(front.y);
  });
});

describe('launch zone', () => {
  const field = getDecodeField();
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;

  it('detects far launch pose', () => {
    const pose = { x: 72, y: 12, heading: Math.PI / 2 };
    expect(robotInLaunchZone(pose, footprint, field)).toBe(true);
  });

  it('rejects mid-field pose away from launch lines', () => {
    const pose = { x: 24, y: 48, heading: 0 };
    expect(robotInLaunchZone(pose, footprint, field)).toBe(false);
  });

  it('detects footprint overlap when center and corners are outside the zone', () => {
    // Robot straddles the far launch triangle edge; OBB overlaps even if sample points miss.
    const pose = { x: 72, y: 28, heading: Math.PI / 2 };
    const corners = robotFootprintCorners(pose, footprint);
    const launchZones = field.zones.filter((z) => z.type === 'launch_zone');
    const anySampleInside = [...corners, { x: pose.x, y: pose.y }].some((point) =>
      launchZones.some((zone) => pointInPolygon(point, zone.polygon)),
    );
    expect(anySampleInside).toBe(false);
    expect(robotInLaunchZone(pose, footprint, field)).toBe(true);
  });
});

describe('stuck artifact detection', () => {
  const field = getDecodeField();

  it('detects artifact inside goal barrier polygon', () => {
    const stuck = detectArtifactStuckInStructure(field, { x: 142, y: 135 });
    expect(stuck?.kind).toBe('goal_barrier');
    expect(stuck?.alliance).toBe('red');
  });

  it('detects artifact inside ramp column', () => {
    const stuck = detectArtifactStuckInStructure(field, { x: 141, y: 90 });
    expect(stuck?.kind).toBe('ramp');
    expect(stuck?.alliance).toBe('red');
  });

  it('ignores overflow exit corridor below ramp bottom', () => {
    const stuck = detectArtifactStuckInStructure(field, { x: 3, y: 68 });
    expect(stuck).toBeNull();
  });
});

describe('shot planner', () => {
  const field = getDecodeField();
  const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;

  it('builds straight trajectory toward alliance basin along robot heading', () => {
    const pose = { x: 60, y: 12, heading: Math.PI / 2 };
    const plan = planShot(pose, { x: 0, y: 0 }, footprint, field, 'blue');
    expect(plan.trajectory.length).toBeGreaterThan(2);
    expect(plan.shotSpeed).toBeGreaterThanOrEqual(55);
    expect(plan.distanceToGoal).toBeGreaterThan(0);
    const forward = robotForwardUnit(pose);
    expect(Math.sign(plan.initialVelocity.x)).toBe(Math.sign(forward.x));
    expect(Math.sign(plan.initialVelocity.y)).toBe(Math.sign(forward.y));
    const p0 = plan.trajectory[0]!.position;
    const p1 = plan.trajectory[1]!.position;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    expect(Math.abs(dx * forward.y - dy * forward.x)).toBeLessThan(0.01);
  });
});

describe('ramp slots', () => {
  it('stacks nine balls bottom-up with 5″ spacing', () => {
    const slots = rampSlotPositions('blue');
    expect(slots).toHaveLength(9);
    expect(slots[0]!.y).toBe(72.5);
    expect(slots[1]!.y - slots[0]!.y).toBe(5);
    expect(slots[8]!.y).toBe(72.5 + 8 * 5);
  });
});

describe('artifact collider reconcile', () => {
  it('re-enables colliders for on-field artifacts left parked', () => {
    const field = getDecodeField();
    const sim = new ArtifactSimulation(
      field,
      new DecodeRulesEngine({ field, alliance: 'blue' }),
      'blue',
    );
    sim.init(getMatchArtifactStaging());
    const enabled = new Map<string, boolean>();
    const activated: string[] = [];
    const stationActivated: string[] = [];
    const physics: PhysicsAdapter = {
      getArtifactPose: () => ({ x: 40, y: 40, heading: 0 }),
      getArtifactVelocity: () => ({ x: 0, y: 0 }),
      setArtifactPose: () => {},
      setArtifactVelocity: () => {},
      setArtifactEnabled: (bodyId, on) => {
        enabled.set(bodyId, on);
      },
      isArtifactColliderEnabled: (bodyId) => enabled.get(bodyId) ?? false,
      isArtifactColliderActive: (bodyId) => enabled.get(bodyId) ?? false,
      ensureArtifactColliderForPhase: (bodyId) => {
        activated.push(bodyId);
        enabled.set(bodyId, true);
      },
      parkArtifactBody: (bodyId) => {
        enabled.set(bodyId, false);
      },
      activateArtifactBody: (bodyId) => {
        activated.push(bodyId);
        enabled.set(bodyId, true);
      },
      activateStationArtifactBody: (bodyId) => {
        stationActivated.push(bodyId);
        enabled.set(bodyId, true);
      },
      syncRobotCollider: () => {},
      step: () => {},
    };

    sim.syncHumanPlayerStation('auto', physics);
    const onField = sim.getSnapshot().artifacts.find((a) => a.phase === 'onField');
    expect(onField).toBeDefined();
    enabled.set(onField!.bodyId, false);

    sim.tick(
      0.02,
      { x: 20, y: 20, heading: 0 },
      { x: 0, y: 0 },
      DEFAULT_KINEMATIC_ROBOT.footprint,
      physics,
      'blue',
      'auto',
    );

    expect(activated).toContain(onField!.bodyId);
  });
});

describe('gate release flow', () => {
  it('queues overlapping staggered ramp rolls with slot-aligned start poses', () => {
    const field = getDecodeField();
    const rules = new DecodeRulesEngine({ field, alliance: 'blue' });
    const sim = new ArtifactSimulation(field, rules, 'blue');
    sim.init(getMatchArtifactStaging());
    const footprint = DEFAULT_KINEMATIC_ROBOT.footprint;

    const simInternal = sim as unknown as {
      rampSlots: { blue: (string | null)[] };
      artifacts: Map<string, SimArtifactState>;
      rampRolls: Array<{ artifactId: string; startTime: number; duration: number }>;
    };
    const slotPositions = rampSlotPositions('blue');
    const onField = sim.getRenderArtifacts().filter((a) => a.phase === 'onField');
    const ballCount = Math.min(onField.length, slotPositions.length);
    expect(ballCount).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < ballCount; i++) {
      const artifact = onField[i]!;
      simInternal.rampSlots.blue[i] = artifact.id;
      const state = simInternal.artifacts.get(artifact.id)!;
      state.phase = 'onRamp';
      state.pose = { ...slotPositions[i]!, heading: 0 };
      rules.classifyArtifact('blue', artifact.color, true);
    }

    const rollStarts: number[] = [];
    let maxConcurrentRolls = 0;
    const artifactPoses = new Map<string, { x: number; y: number; heading: number }>();
    const physics: PhysicsAdapter = {
      ...mockPhysics(),
      getArtifactPose: (bodyId) => artifactPoses.get(bodyId) ?? { x: 0, y: 0, heading: 0 },
      setArtifactPose: (bodyId, pose) => {
        artifactPoses.set(bodyId, pose);
      },
      isArtifactColliderActive: (bodyId) => artifactPoses.has(bodyId),
      ensureArtifactColliderForPhase: (bodyId, _phase, pose, _vx = 0, _vy = 0) => {
        artifactPoses.set(bodyId, pose);
      },
      activateArtifactBody: (bodyId, pose) => {
        artifactPoses.set(bodyId, pose);
      },
      parkArtifactBody: (bodyId) => {
        artifactPoses.delete(bodyId);
      },
      step: () => {},
    };

    const gatePose = { x: 0, y: 69, heading: 0 };
    const robot = {
      robotId: 'player',
      pose: gatePose,
      linear: { x: 0, y: 0 },
      alliance: 'blue' as const,
      command: {},
      shootEdge: false,
      gateEdge: false,
      shootHeld: false,
    };

    sim.tickRobots(0.02, [robot], footprint, physics, 'teleop');
    const queue = sim.getSnapshot().gateReleaseQueue;
    expect(queue.length + simInternal.rampRolls.length).toBe(ballCount);
    const releaseTimes = [
      ...simInternal.rampRolls.map((roll) => roll.startTime),
      ...queue.map((item) => item.releaseAt),
    ].sort((a, b) => a - b);
    expect(releaseTimes).toHaveLength(ballCount);
    for (let i = 0; i < ballCount; i++) {
      expect(releaseTimes[i]).toBeCloseTo(releaseTimes[0]! + i * GATE_RELEASE_INTERVAL_S, 5);
    }
    for (const item of queue) {
      expect(item.startPose.y).toBeCloseTo(slotPositions[item.slotIndex]!.y, 3);
    }

    const exitPose = rampSouthExitPose('blue');
    const dt = 1 / 120;
    for (let step = 0; step < 1200; step++) {
      sim.tickRobots(dt, [robot], footprint, physics, 'teleop');
      maxConcurrentRolls = Math.max(maxConcurrentRolls, simInternal.rampRolls.length);
      for (const roll of simInternal.rampRolls) {
        if (!rollStarts.includes(roll.startTime)) {
          rollStarts.push(roll.startTime);
        }
      }
      if (!sim.isGateReleaseInProgress()) break;
    }

    expect(maxConcurrentRolls).toBeGreaterThan(1);
    expect(rollStarts.length).toBe(ballCount);
    for (let i = 1; i < rollStarts.length; i++) {
      expect(rollStarts[i]! - rollStarts[i - 1]!).toBeCloseTo(GATE_RELEASE_INTERVAL_S, 1);
    }
    if (rollStarts.length >= 2) {
      const sortedStarts = [...rollStarts].sort((a, b) => a - b);
      expect(sortedStarts[0]! + RAMP_ROLL_MIN_S).toBeGreaterThan(sortedStarts[1]!);
    }

    const rampIds = onField.slice(0, ballCount).map((artifact) => artifact.id);
    for (const id of rampIds) {
      const artifact = sim.getRenderArtifacts().find((entry) => entry.id === id);
      expect(artifact?.phase).toBe('onField');
      expect(artifact?.pose.y).toBeCloseTo(exitPose.y, 2);
    }
    expect(sim.isGateReleaseInProgress()).toBe(false);
  });
});
