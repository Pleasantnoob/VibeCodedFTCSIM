import { normalizeAngle } from '@ftc-sim/field';
import type {
  BotDebugState,
  BotDriveSample,
  BotRobotSnapshot,
  BotSlotConfig,
  BotTaskKind,
  BotWorldSnapshot,
} from './types.js';
import { BOT_AI_VERSION } from './types.js';
import { pickCollectTarget, scanCollectibleArtifacts } from './artifacts.js';
import {
  ENDGAME_FORCE_PARK_SEC,
  ENDGAME_NO_NEW_TASKS_SEC,
  artifactTooCloseToOpponentGate,
  gateApproachPoint,
  isGateOpen,
  isRampFull,
  parkReturnStatus,
  pickLaunchZoneForScorer,
  staggeredParkTarget,
  type EndgameRole,
} from './coordination.js';
import {
  allyBlocksParkApproach,
  fieldDriveTowardPark,
} from './navigation/park-navigation.js';
import {
  fieldDriveAlignShoot,
  fieldDriveScoreApproach,
  fieldDriveToCollect,
  fieldDriveToward,
  intakeFaceHeading,
  intakeHeadingError,
  zeroDrive,
} from './drive/field-drive.js';
import {
  checkInGateZone,
  checkInLaunchZone,
  launchApproach,
  shootAlignTolerance,
  shootHeadingError,
  shootHeadingForAlliance,
  shootMechanismForPose,
} from './launch-helpers.js';
import {
  createStuckTracker,
  updateStuckTracker,
  type StuckTracker,
} from './navigation/stuck-tracker.js';

const TARGET_STORED = 3;
const STATUS_LOG_INTERVAL_SEC = 1.5;

export interface CollectorRobotState {
  commitScoring: boolean;
  committedLaunchZone: 'near' | 'far' | null;
  currentTask: BotTaskKind | null;
  lastArtifactId: string | null;
  lastLaunchZone: string | null;
  lastStoredCount: number;
  lastStatusLogAt: number;
  stuck: StuckTracker;
}

export interface CollectorContext {
  gateAssignees: ReadonlySet<string>;
  allyLaunchZones: ReadonlyMap<string, 'near' | 'far'>;
  allyArtifactIds: ReadonlyMap<string, string>;
  endgameRoles: ReadonlyMap<string, EndgameRole>;
  allyTasks: ReadonlyMap<string, BotTaskKind>;
}

export function createCollectorState(): CollectorRobotState {
  return {
    commitScoring: false,
    committedLaunchZone: null,
    currentTask: null,
    lastArtifactId: null,
    lastLaunchZone: null,
    lastStoredCount: 0,
    lastStatusLogAt: -Infinity,
    stuck: createStuckTracker(),
  };
}

function flankedArtifactStandoff(
  artifact: { x: number; y: number },
  alliance: 'blue' | 'red',
): { x: number; y: number } {
  const gate = alliance === 'blue' ? { x: 135, y: 69 } : { x: 9, y: 69 };
  const dx = artifact.x - gate.x;
  const dy = artifact.y - gate.y;
  const len = Math.hypot(dx, dy) || 1;
  const standoff = 12;
  return {
    x: artifact.x + (dx / len) * standoff,
    y: artifact.y + (dy / len) * standoff,
  };
}

function allianceForRobotId(robotId: string): BotDebugState['alliance'] {
  if (robotId === 'red-far' || robotId === 'red-near') return 'red';
  return 'blue';
}

function allowsBotDrive(world: BotWorldSnapshot): boolean {
  const match = world.match;
  if (!match.running || match.paused) return false;
  return (
    match.allowsDrive || match.phase === 'auto' || match.phase === 'transition'
  );
}

function selectTask(
  world: BotWorldSnapshot,
  slot: BotSlotConfig,
  robot: BotRobotSnapshot,
  state: CollectorRobotState,
  ctx: CollectorContext,
): BotTaskKind {
  const stored = robot.stored.length;
  const phase = world.match.phase;
  const timeLeft = world.match.timeRemainingInPhase;
  const teleop = phase === 'teleop';
  const infinite = world.match.infiniteMode;

  if (teleop && !infinite && timeLeft <= ENDGAME_FORCE_PARK_SEC) {
    return 'park';
  }

  if (teleop && !infinite && timeLeft <= ENDGAME_NO_NEW_TASKS_SEC) {
    const role = ctx.endgameRoles.get(slot.robotId);
    if (role === 'finisher') {
      if (stored > 0) return 'score';
      if (state.commitScoring && stored > 0) return 'score';
      return 'park';
    }
    if (role === 'parker') return 'park';
    if (state.currentTask === 'score' && stored > 0) return 'score';
    if (stored >= TARGET_STORED) return 'score';
    return 'park';
  }

  const gateEligible =
    ctx.gateAssignees.has(slot.robotId) &&
    isRampFull(world, robot.alliance) &&
    !isGateOpen(world, robot.alliance);

  if (gateEligible) return 'gate';

  if (stored >= TARGET_STORED) {
    state.commitScoring = true;
    return 'score';
  }

  if (stored === 0) state.commitScoring = false;
  if (state.commitScoring && stored > 0) return 'score';
  return 'collect';
}

const INTAKE_MECHANISM = {
  command: { intake: 1 as const },
  shootEdge: false,
  gateEdge: false,
  shootHeld: false,
};

const IDLE_MECHANISM = {
  command: {},
  shootEdge: false,
  gateEdge: false,
  shootHeld: false,
};

export interface CollectorTickResult {
  sample: BotDriveSample;
  debug: BotDebugState;
  logLines: string[];
}

export function tickSimpleCollector(
  world: BotWorldSnapshot,
  slot: BotSlotConfig,
  state: CollectorRobotState,
  ctx: CollectorContext = {
    gateAssignees: new Set(),
    allyLaunchZones: new Map(),
    allyArtifactIds: new Map(),
    endgameRoles: new Map(),
    allyTasks: new Map(),
  },
): CollectorTickResult {
  const robot = world.robots.find((entry) => entry.id === slot.robotId);
  const elapsedSec = world.match.timeElapsed;
  const logLines: string[] = [];

  if (!robot) {
    return {
      sample: { input: zeroDrive(), mechanism: INTAKE_MECHANISM },
      debug: idleDebug(slot, 0),
      logLines: [`MISSING_ROBOT no pose for ${slot.robotId}`],
    };
  }

  const storedCount = robot.stored.length;
  const canDrive = allowsBotDrive(world);
  const task = selectTask(world, slot, robot, state, ctx);
  state.currentTask = task;

  if (storedCount !== state.lastStoredCount) {
    if (storedCount > state.lastStoredCount && task === 'collect') {
      logLines.push(`STORED +1 now=${storedCount}/${TARGET_STORED}`);
    }
    if (storedCount < state.lastStoredCount && task === 'score') {
      logLines.push(`SHOT stored=${storedCount} remaining`);
    }
    if (storedCount === 0 && state.lastStoredCount > 0) {
      logLines.push(`EMPTY search=on collect again`);
      state.lastArtifactId = null;
      state.commitScoring = false;
      state.committedLaunchZone = null;
      state.stuck.launchZone = null;
    }
    if (storedCount >= TARGET_STORED && state.lastStoredCount < TARGET_STORED) {
      logLines.push(`FULL stored=${storedCount}/${TARGET_STORED} → launch`);
    }
    state.lastStoredCount = storedCount;
  }

  switch (task) {
    case 'park':
      return tickParkPhase(world, slot, robot, state, ctx, canDrive, elapsedSec, logLines);
    case 'gate':
      return tickGatePhase(world, slot, robot, state, canDrive, elapsedSec, logLines);
    case 'score':
      return tickScorePhase(world, slot, robot, state, ctx, canDrive, elapsedSec, logLines);
    default:
      return tickCollectPhase(
        world,
        slot,
        robot,
        state,
        ctx,
        canDrive,
        storedCount,
        elapsedSec,
        logLines,
      );
  }
}

function tickCollectPhase(
  world: BotWorldSnapshot,
  slot: BotSlotConfig,
  robot: BotRobotSnapshot,
  state: CollectorRobotState,
  ctx: CollectorContext,
  canDrive: boolean,
  storedCount: number,
  elapsedSec: number,
  logLines: string[],
): CollectorTickResult {
  let scan = pickCollectTarget(
    robot,
    world.artifacts,
    world.robots,
    state.stuck.blockedArtifactIds,
    slot.difficulty,
    ctx.allyArtifactIds,
  );
  if (!scan.pick && state.stuck.blockedArtifactIds.size > 0) {
    state.stuck.blockedArtifactIds.clear();
    scan = pickCollectTarget(
      robot,
      world.artifacts,
      world.robots,
      state.stuck.blockedArtifactIds,
      slot.difficulty,
      ctx.allyArtifactIds,
    );
  }
  const pick = scan.pick;
  if (!pick) {
    const summary = scanCollectibleArtifacts(
      robot,
      world.artifacts,
      world.robots,
      state.stuck.blockedArtifactIds,
    );
    if (elapsedSec - state.lastStatusLogAt >= STATUS_LOG_INTERVAL_SEC) {
      state.lastStatusLogAt = elapsedSec;
      logLines.push(
        `WAIT stored=${storedCount}/${TARGET_STORED} scan total=${summary.total} ok=${summary.collectible} held=${summary.held} blocked=${summary.blocked} phase=${summary.wrongPhase} ally=${summary.wrongAlliance} hp=${summary.humanPlayer}`,
      );
    }
    return buildResult({
      slot,
      robot,
      task: 'idle',
      target: null,
      storedCount,
      input: zeroDrive(),
      mechanism: INTAKE_MECHANISM,
      path: [],
      aligned: false,
      atGoal: true,
      inLaunchZone: false,
      canDrive,
      logLines,
      goalNode: 'none',
    });
  }

  const { artifact, dist, cluster, mode } = pick;
  const artifactPos = { x: artifact.pose.x, y: artifact.pose.y };
  const nearOpponentGate = artifactTooCloseToOpponentGate(artifact.pose, robot.alliance);
  const target = nearOpponentGate
    ? flankedArtifactStandoff(artifactPos, robot.alliance)
    : artifactPos;
  const approachDist = Math.hypot(target.x - robot.pose.x, target.y - robot.pose.y);
  const facing = Math.abs(intakeHeadingError(robot.pose, artifactPos)) <= 0.15;
  const path = [{ x: robot.pose.x, y: robot.pose.y }, target, artifactPos];

  if (artifact.id !== state.lastArtifactId) {
    logLines.push(
      `TARGET ${artifact.id} color=${artifact.color} dist=${dist.toFixed(1)}in cluster=${cluster} mode=${mode} stored=${storedCount}/${TARGET_STORED}`,
    );
    state.lastArtifactId = artifact.id;
  }

  if (
    logLines.length === 0 &&
    elapsedSec - state.lastStatusLogAt >= STATUS_LOG_INTERVAL_SEC
  ) {
    state.lastStatusLogAt = elapsedSec;
    const summary = scanCollectibleArtifacts(robot, world.artifacts, world.robots);
    logLines.push(
      `SCAN ok=${summary.collectible}/${summary.total} DRIVE → ${artifact.id} dist=${dist.toFixed(1)}in`,
    );
  }

  let input = canDrive
    ? nearOpponentGate && approachDist > 3
      ? fieldDriveToward(robot.pose, target, {
          faceHeading: intakeFaceHeading(robot.pose, artifactPos),
          maxSpeed: 0.55,
          difficulty: slot.difficulty,
        })
      : fieldDriveToCollect(robot.pose, artifactPos, slot.difficulty)
    : zeroDrive();

  const stuck = updateStuckTracker(
    state.stuck,
    robot.pose,
    robot.linear,
    input,
    elapsedSec,
    { artifactId: artifact.id },
  );
  if (stuck) {
    logLines.push(`STUCK retarget skip=${artifact.id} blocked=${state.stuck.blockedArtifactIds.size}`);
    state.lastArtifactId = null;
    input = zeroDrive();
  }

  return buildResult({
    slot,
    robot,
    task: 'collect',
    target,
    artifactId: artifact.id,
    storedCount,
    input,
    mechanism: INTAKE_MECHANISM,
    path,
    aligned: facing,
    atGoal: dist < 2.5,
    inLaunchZone: false,
    canDrive,
    logLines,
    goalNode: artifact.id,
    dist,
    stuckPhase: stuck ? 'recovery' : 'normal',
    collectScan: {
      chosenId: artifact.id,
      polled: scan.polled,
    },
  });
}

function tickScorePhase(
  world: BotWorldSnapshot,
  slot: BotSlotConfig,
  robot: BotRobotSnapshot,
  state: CollectorRobotState,
  ctx: CollectorContext,
  canDrive: boolean,
  elapsedSec: number,
  logLines: string[],
): CollectorTickResult {
  const storedCount = robot.stored.length;
  const inLaunch = checkInLaunchZone(robot.pose, world.footprint, world.field);
  const alignTol = shootAlignTolerance(robot.pose, robot.alliance);
  const aligned = Math.abs(shootHeadingError(robot.pose, robot.alliance)) < alignTol;
  if (!state.committedLaunchZone) {
    state.committedLaunchZone = pickLaunchZoneForScorer(
      slot.robotId,
      world.robots,
      robot.alliance,
      ctx.allyLaunchZones,
    );
  }
  const preferZone = state.stuck.launchZone ?? state.committedLaunchZone;
  const { target: launchTarget, zone } = launchApproach(
    robot.pose,
    robot.alliance,
    preferZone,
  );
  const distLaunch = Math.hypot(
    launchTarget.x - robot.pose.x,
    launchTarget.y - robot.pose.y,
  );

  if (`${zone}` !== state.lastLaunchZone) {
    logLines.push(`LAUNCH zone=${zone} dist=${distLaunch.toFixed(1)}in stored=${storedCount}`);
    state.lastLaunchZone = `${zone}`;
  }

  const shootMech = shootMechanismForPose(robot.pose, robot.alliance, inLaunch);
  if (shootMech.command.shoot) {
    if (elapsedSec - state.lastStatusLogAt >= 0.5) {
      state.lastStatusLogAt = elapsedSec;
      logLines.push(`SHOOT stored=${storedCount} tier=${inLaunch ? 'in' : 'out'}`);
    }
    return buildResult({
      slot,
      robot,
      task: 'score',
      target: launchTarget,
      storedCount,
      input: zeroDrive(),
      mechanism: {
        command: shootMech.command,
        shootEdge: shootMech.shootEdge,
        gateEdge: false,
        shootHeld: shootMech.shootHeld,
      },
      path: [{ x: robot.pose.x, y: robot.pose.y }, launchTarget],
      aligned: true,
      atGoal: true,
      inLaunchZone: inLaunch,
      canDrive,
      logLines,
      goalNode: `launch_${zone}`,
      driveSource: 'auto',
      dist: distLaunch,
    });
  }

  if (
    logLines.length === 0 &&
    elapsedSec - state.lastStatusLogAt >= STATUS_LOG_INTERVAL_SEC
  ) {
    state.lastStatusLogAt = elapsedSec;
    logLines.push(
      `SCORE → ${zone} dist=${distLaunch.toFixed(0)}in inZone=${inLaunch ? 'yes' : 'no'} aligned=${aligned ? 'yes' : 'no'} err=${Math.abs(shootHeadingError(robot.pose, robot.alliance)).toFixed(3)} tol=${alignTol.toFixed(3)}`,
    );
  }

  const shootHeading = shootHeadingForAlliance(robot.pose, robot.alliance);
  let input = canDrive
    ? inLaunch && !aligned
      ? fieldDriveAlignShoot(robot.pose, shootHeading, slot.difficulty, launchTarget)
      : fieldDriveScoreApproach(robot.pose, launchTarget, shootHeading, slot.difficulty)
    : zeroDrive();

  const stuck = updateStuckTracker(
    state.stuck,
    robot.pose,
    robot.linear,
    input,
    elapsedSec,
    {
      launchZone: !inLaunch && distLaunch > 8 ? zone : undefined,
      allowTurnOnly: inLaunch && !aligned,
    },
  );
  if (stuck && state.stuck.launchZone) {
    state.committedLaunchZone = state.stuck.launchZone;
    logLines.push(`STUCK align=${aligned ? 'yes' : 'no'} switch launch → ${state.stuck.launchZone}`);
    state.lastLaunchZone = null;
  }

  return buildResult({
    slot,
    robot,
    task: 'score',
    target: launchTarget,
    storedCount,
    input,
    mechanism: IDLE_MECHANISM,
    path: [{ x: robot.pose.x, y: robot.pose.y }, launchTarget],
    aligned,
    atGoal: inLaunch && aligned,
    inLaunchZone: inLaunch,
    canDrive,
    logLines,
    goalNode: `launch_${zone}`,
    driveSource: inLaunch && !aligned ? 'rotate' : 'motion',
    dist: distLaunch,
    stuckPhase: stuck ? 'recovery' : 'normal',
  });
}

function tickGatePhase(
  world: BotWorldSnapshot,
  slot: BotSlotConfig,
  robot: BotRobotSnapshot,
  state: CollectorRobotState,
  canDrive: boolean,
  elapsedSec: number,
  logLines: string[],
): CollectorTickResult {
  const gateTarget = gateApproachPoint(robot.alliance);
  const inZone = checkInGateZone(robot.pose, world.footprint, world.field, robot.alliance);
  const dist = Math.hypot(gateTarget.x - robot.pose.x, gateTarget.y - robot.pose.y);

  if (logLines.length === 0 && elapsedSec - state.lastStatusLogAt >= STATUS_LOG_INTERVAL_SEC) {
    state.lastStatusLogAt = elapsedSec;
    logLines.push(
      `GATE dist=${dist.toFixed(1)}in pos=(${robot.pose.x.toFixed(1)},${robot.pose.y.toFixed(1)}) inZone=${inZone ? 'yes' : 'no'}`,
    );
  }

  if (inZone) {
    return buildResult({
      slot,
      robot,
      task: 'gate',
      target: gateTarget,
      storedCount: robot.stored.length,
      input: zeroDrive(),
      mechanism: {
        command: { gate: true },
        shootEdge: false,
        gateEdge: true,
        shootHeld: false,
      },
      path: [{ x: robot.pose.x, y: robot.pose.y }, gateTarget],
      aligned: true,
      atGoal: true,
      inLaunchZone: false,
      canDrive,
      logLines,
      goalNode: 'gate',
      dist,
    });
  }

  // Creep into the narrow gate zone — default arriveIn stops ~2.5" short and never overlaps the zone.
  const arriveIn = dist < 14 ? 0.35 : 2.5;
  let input = canDrive
    ? fieldDriveToward(robot.pose, gateTarget, {
        maxSpeed: dist < 6 ? 0.35 : 0.75,
        arriveIn,
        difficulty: slot.difficulty,
      })
    : zeroDrive();

  const stuck = updateStuckTracker(
    state.stuck,
    robot.pose,
    robot.linear,
    input,
    elapsedSec,
  );
  if (stuck) {
    logLines.push(
      `STUCK gate at (${robot.pose.x.toFixed(1)},${robot.pose.y.toFixed(1)}) dist=${dist.toFixed(1)} — pause`,
    );
    input = zeroDrive();
  }

  return buildResult({
    slot,
    robot,
    task: 'gate',
    target: gateTarget,
    storedCount: robot.stored.length,
    input,
    mechanism: IDLE_MECHANISM,
    path: [{ x: robot.pose.x, y: robot.pose.y }, gateTarget],
    aligned: false,
    atGoal: false,
    inLaunchZone: false,
    canDrive,
    logLines,
    goalNode: 'gate',
    dist,
    stuckPhase: stuck ? 'recovery' : 'normal',
  });
}

function tickParkPhase(
  world: BotWorldSnapshot,
  slot: BotSlotConfig,
  robot: BotRobotSnapshot,
  state: CollectorRobotState,
  ctx: CollectorContext,
  canDrive: boolean,
  elapsedSec: number,
  logLines: string[],
): CollectorTickResult {
  const park = staggeredParkTarget(world.field, robot.alliance, slot.robotId);
  const dist = Math.hypot(park.target.x - robot.pose.x, park.target.y - robot.pose.y);
  const headingErr = Math.abs(normalizeAngle(robot.pose.heading - park.heading));
  const aligned = headingErr < 0.15;
  const parkStatus = parkReturnStatus(robot.pose, world.footprint, world.field, robot.alliance);
  const atBase = parkStatus === 'full';

  if (logLines.length === 0 && elapsedSec - state.lastStatusLogAt >= STATUS_LOG_INTERVAL_SEC) {
    state.lastStatusLogAt = elapsedSec;
    const role = ctx.endgameRoles.get(slot.robotId);
    logLines.push(
      `PARK base=(${park.target.x.toFixed(0)},${park.target.y.toFixed(0)}) dist=${dist.toFixed(1)}in status=${parkStatus} role=${role ?? 'solo'} aligned=${aligned ? 'yes' : 'no'}`,
    );
  }

  let input = zeroDrive();
  const allyBlocking = allyBlocksParkApproach(
    robot,
    park.target,
    world.robots,
    ctx.allyTasks,
  );

  if (canDrive && !atBase && !allyBlocking) {
    if (parkStatus === 'partial' && !aligned) {
      input = fieldDriveAlignShoot(robot.pose, park.heading, slot.difficulty);
    } else {
      input = fieldDriveTowardPark(
        robot.pose,
        park.target,
        world.robots,
        slot.robotId,
        robot.alliance,
        {
          faceHeading: parkStatus !== 'none' ? park.heading : undefined,
          arriveIn: parkStatus === 'partial' ? 0.75 : 3,
          maxSpeed: parkStatus === 'partial' ? 0.45 : 0.85,
          difficulty: slot.difficulty,
        },
      );
    }
  } else if (allyBlocking && canDrive && !atBase) {
    logLines.push('PARK yield ally clearing base lane');
  }

  const stuck = updateStuckTracker(
    state.stuck,
    robot.pose,
    robot.linear,
    input,
    elapsedSec,
  );
  if (stuck) {
    logLines.push('STUCK park detour');
    const detourSide = slot.robotId.includes('near') ? 0.55 : -0.55;
    input = { ...zeroDrive(), strafe: detourSide, forward: 0.35 };
  }

  const pathWaypoints = [{ x: robot.pose.x, y: robot.pose.y }, park.target];
  return buildResult({
    slot,
    robot,
    task: 'park',
    target: park.target,
    storedCount: robot.stored.length,
    input,
    mechanism: IDLE_MECHANISM,
    path: pathWaypoints,
    aligned,
    atGoal: atBase,
    inLaunchZone: false,
    canDrive,
    logLines,
    goalNode: 'base',
    dist,
    stuckPhase: stuck ? 'recovery' : 'normal',
  });
}

interface BuildResultArgs {
  slot: BotSlotConfig;
  robot: BotRobotSnapshot;
  task: BotTaskKind;
  target: { x: number; y: number } | null;
  artifactId?: string;
  storedCount: number;
  input: ReturnType<typeof zeroDrive>;
  mechanism: BotDriveSample['mechanism'];
  path: { x: number; y: number }[];
  aligned: boolean;
  atGoal: boolean;
  inLaunchZone: boolean;
  canDrive: boolean;
  logLines: string[];
  goalNode: string;
  driveSource?: 'stuck' | 'auto' | 'motion' | 'rotate';
  dist?: number;
  stuckPhase?: BotDebugState['stuckPhase'];
  collectScan?: BotDebugState['collectScan'];
}

function buildResult(args: BuildResultArgs): CollectorTickResult {
  const {
    slot,
    robot,
    task,
    target,
    artifactId,
    storedCount,
    input,
    mechanism,
    path,
    aligned,
    atGoal,
    inLaunchZone,
    canDrive,
    logLines,
    goalNode,
    driveSource = 'motion',
    dist = target
      ? Math.hypot(target.x - robot.pose.x, target.y - robot.pose.y)
      : 0,
    stuckPhase = 'normal',
    collectScan,
  } = args;

  return {
    sample: {
      input,
      driveFrame: 'field',
      mechanism,
    },
    debug: {
      robotId: slot.robotId,
      alliance: allianceForRobotId(slot.robotId),
      aiVersion: BOT_AI_VERSION,
      driveFrame: 'field',
      task,
      target,
      artifactId,
      storedCount,
      inLaunchZone,
      aligned,
      atGoal,
      stuckPhase,
      pathLength: path.length,
      path,
      reactionMsRemaining: 0,
      replanCount: 0,
      collectScan,
      nav: {
        pose: {
          x: robot.pose.x,
          y: robot.pose.y,
          heading: robot.pose.heading,
        },
        velocity: {
          x: robot.linear.x,
          y: robot.linear.y,
          speed: Math.hypot(robot.linear.x, robot.linear.y),
        },
        taskTarget: target ?? { x: robot.pose.x, y: robot.pose.y },
        rawTaskTarget: target ?? { x: robot.pose.x, y: robot.pose.y },
        motionGoal: target,
        pursuitTarget: target,
        waypointIndex: path.length > 1 ? 1 : 0,
        pathLength: path.length,
        distTask: dist,
        distGoal: dist,
        distPursuit: dist,
        startNode: 'self',
        goalNode,
        nodePath: ['self', goalNode],
        pathSignature: `${goalNode}@${Math.round(dist)}`,
        driveSource,
        driveRaw: { f: input.forward, s: input.strafe, t: input.turn },
        driveAvoid: { f: input.forward, s: input.strafe, t: input.turn },
        driveBarrier: { f: input.forward, s: input.strafe, t: input.turn },
        driveFinal: { f: input.forward, s: input.strafe, t: input.turn },
        flags: canDrive ? [] : ['drive_blocked'],
      },
    },
    logLines,
  };
}

function idleDebug(slot: BotSlotConfig, storedCount: number): BotDebugState {
  return {
    robotId: slot.robotId,
    alliance: allianceForRobotId(slot.robotId),
    aiVersion: BOT_AI_VERSION,
    driveFrame: 'field',
    task: 'idle',
    target: null,
    storedCount,
    inLaunchZone: false,
    aligned: false,
    atGoal: true,
    stuckPhase: 'normal',
    pathLength: 0,
    path: [],
    reactionMsRemaining: 0,
    replanCount: 0,
  };
}
