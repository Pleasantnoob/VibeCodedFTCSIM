import { normalizeAngle } from '@ftc-sim/field';
import { evaluateBaseReturn } from '@ftc-sim/game-decode';
import { robotInLaunchZone } from '@ftc-sim/mechanisms';
import type { Pose, Vector2 } from '@ftc-sim/field';
import type { RobotFootprint } from '@ftc-sim/robot';
import type {
  Difficulty,
  BotDebugState,
  BotDriveSample,
  BotMetrics,
  BotNavTrace,
  BotObservation,
  BotReplanReason,
  BotTaskGoal,
  BotWorldSnapshot,
} from '../types.js';
import { buildObservation } from '../perception/observation-builder.js';
import { BlackboardRegistry } from '../cognition/blackboard.js';
import { decideTask } from '../cognition/behavior-tree/index.js';
import { shouldPark, shootHeading } from '../cognition/task-selector.js';
import { mechanismForTask, headingTowardBasin, isAlignedForShot } from '../skills/mechanism-skill.js';
import { buildDecodeFieldGraph } from '../navigation/field-graph.js';
import { PathPlanner } from '../navigation/path-planner.js';
import { TaskNavigator } from '../navigation/task-navigator.js';
import { applyLocalAvoidance } from '../navigation/local-avoidance.js';
import { applyBarrierSlide } from '../navigation/barrier-avoidance.js';
import { StuckRecovery } from '../navigation/stuck-recovery.js';
import { profileForDifficulty } from '../personality/difficulty.js';
import { InputSmoother, ReactionDelay } from '../personality/reaction-delay.js';
import { BotDebugLog } from '../debug/bot-debug-log.js';
import { AutoRoutineRunner, routineForRobot } from '../auto/auto-routines.js';
import { fieldRotateToward } from '../navigation/trajectory-generator.js';
import type { HolonomicInput } from '@ftc-sim/robot';

const fieldGraph = buildDecodeFieldGraph();
const DEBUG_LOG_INTERVAL_SEC = 0.5;
const NAV_TRACE_INTERVAL_SEC = 0.25;
const REPLAN_INTERVAL_SEC = 0.75;
const REPLAN_COOLDOWN_SEC = 2;
const COLLECT_STUCK_RELEASE_SEC = 2;

function driveVec(input: HolonomicInput): BotNavTrace['driveRaw'] {
  return {
    f: +(input.forward ?? 0).toFixed(3),
    s: +(input.strafe ?? 0).toFixed(3),
    t: +(input.turn ?? 0).toFixed(3),
  };
}

function buildNavFlags(
  task: BotTaskGoal,
  nav: Omit<BotNavTrace, 'flags'>,
  atGoal: boolean,
  stuckPhase: string,
): string[] {
  const flags: string[] = [];
  if (task.kind !== 'idle' && task.kind !== 'park' && nav.pathLength === 0) {
    flags.push('no_path');
  }
  if (nav.distTask > 8 && atGoal) {
    flags.push('atGoal_but_far_from_task');
  }
  if (nav.distTask > 24 && nav.distGoal < 6 && task.kind !== 'idle') {
    flags.push('motion_goal_not_task_target');
  }
  if (nav.distPursuit > 28 && nav.pathLength > 0) {
    flags.push('pursuit_far');
  }
  if (stuckPhase !== 'normal') {
    flags.push(`stuck_${stuckPhase}`);
  }
  if (
    Math.abs(nav.driveFinal.f) < 0.05 &&
    Math.abs(nav.driveFinal.s) < 0.05 &&
    Math.abs(nav.driveFinal.t) < 0.05 &&
    nav.distTask > 10 &&
    task.kind !== 'idle' &&
    task.kind !== 'park' &&
    stuckPhase === 'normal' &&
    !(task.kind === 'score' && atGoal) &&
    !(task.kind === 'collect' && nav.distGoal < 8)
  ) {
    flags.push('idle_drive_far_from_target');
  }
  if (
    Math.abs(nav.driveRaw.f - nav.driveAvoid.f) > 0.35 ||
    Math.abs(nav.driveRaw.s - nav.driveAvoid.s) > 0.35
  ) {
    flags.push('avoidance_override');
  }
  if (nav.nodePath.length >= 2 && nav.nodePath.includes('center')) {
    flags.push('route_through_center');
  }
  return flags;
}

function robotFootprintCorners(pose: Pose, footprint: RobotFootprint): Vector2[] {
  const hw = footprint.width / 2;
  const hl = footprint.length / 2;
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  const locals = [
    { x: hl, y: hw },
    { x: hl, y: -hw },
    { x: -hl, y: -hw },
    { x: -hl, y: hw },
  ];
  return locals.map((point) => ({
    x: pose.x + point.x * cos - point.y * sin,
    y: pose.y + point.x * sin + point.y * cos,
  }));
}

function inBaseZone(obs: BotObservation): boolean {
  const zone = obs.field.zones.find(
    (entry) => entry.type === 'base_zone' && entry.alliance === obs.self.alliance,
  );
  if (!zone || zone.polygon.length < 3) return false;
  const corners = robotFootprintCorners(obs.self.pose, obs.footprint);
  return evaluateBaseReturn(corners, zone.polygon) === 'full';
}

function inCenterDwellZone(pose: Pose): boolean {
  return Math.abs(pose.x - 72) < 20 && Math.abs(pose.y - 72) < 30;
}

function shouldBotDrive(obs: BotObservation): boolean {
  if (!obs.match.running || obs.match.paused) return false;
  if (obs.match.phase === 'post' || obs.match.phase === 'setup' || obs.match.phase === 'init') {
    return false;
  }
  if (obs.match.phase === 'auto' || obs.match.phase === 'transition') return true;
  return obs.match.allowsDrive;
}

function brakeSample(driveFrame: 'field' | 'robot' = 'field'): BotDriveSample {
  return {
    input: { forward: 0, strafe: 0, turn: 0, brake: true },
    driveFrame,
    mechanism: {
      command: {},
      shootEdge: false,
      gateEdge: false,
      shootHeld: false,
    },
  };
}

function taskKey(task: BotTaskGoal): string {
  return `${task.kind}|${task.artifactId ?? ''}|${task.goalNodeHint ?? ''}`;
}

export class BotController {
  private readonly robotId: string;
  private difficulty: Difficulty = 'normal';
  private planner: PathPlanner;
  private navigator = new TaskNavigator();
  private stuck = new StuckRecovery();
  private reaction = new ReactionDelay();
  private smoother = new InputSmoother();
  private autoRunner = new AutoRoutineRunner();
  private blackboards: BlackboardRegistry;
  private debugLog: BotDebugLog | null = null;
  private elapsedSec = 0;
  private decideAccumulator = 0;
  private debugLogAccumulator = 0;
  private lastPlanAt = 0;
  private currentTask: BotTaskGoal = { kind: 'idle', target: { x: 72, y: 72 }, utility: 0 };
  private lockedCollectTarget: Vector2 | null = null;
  private pendingMechanism: ReturnType<typeof mechanismForTask> = {};
  private aimError = 0;
  private enabled = true;
  private collectStuckSince = 0;
  private lastDebugState: BotDebugState | null = null;
  private stableDisplayPath: Vector2[] = [];
  private stablePathKey = '';
  private stableDisplayTarget: Vector2 | null = null;
  private stableTargetKey = '';
  private taskKindSince = 0;
  private replanCount = 0;
  private centerDwellSec = 0;
  private lastReplanReason: BotReplanReason | undefined;
  private lastGraphNodeKey = '';
  private lastGoalHint = '';
  private lastGoalGraphNode = '';
  private replanCooldownUntil = 0;
  private simNowMs = 0;
  private lastDriveSource: BotNavTrace['driveSource'] = 'motion';
  private lastNavTrace: BotNavTrace | undefined;

  constructor(
    robotId: string,
    blackboards: BlackboardRegistry,
    difficulty: Difficulty = 'normal',
    debugLog?: BotDebugLog,
  ) {
    this.robotId = robotId;
    this.blackboards = blackboards;
    this.difficulty = difficulty;
    this.debugLog = debugLog ?? null;
    this.planner = new PathPlanner(fieldGraph.nodes, fieldGraph.edges);
    this.aimError = (Math.random() - 0.5) * profileForDifficulty(difficulty).aimErrorRad;
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.aimError = (Math.random() - 0.5) * profileForDifficulty(difficulty).aimErrorRad;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.navigator.clear();
      this.planner.clear();
      this.stuck.reset();
      this.autoRunner.reset();
    }
  }

  getMetrics(): BotMetrics {
    return {
      replanCount: this.replanCount,
      centerDwellSec: this.centerDwellSec,
      lastReplanReason: this.lastReplanReason,
    };
  }

  private applyTaskChange(obs: BotObservation, nextTask: BotTaskGoal): void {
    const board = this.blackboards.forAlliance(obs.self.alliance);
    if (
      this.currentTask.kind === 'collect' &&
      this.currentTask.artifactId &&
      (nextTask.kind !== 'collect' || nextTask.artifactId !== this.currentTask.artifactId)
    ) {
      board.release(this.currentTask.artifactId);
      this.lockedCollectTarget = null;
    }

    if (nextTask.kind === 'collect' && nextTask.artifactId) {
      board.claim(nextTask.artifactId);
      if (nextTask.artifactId !== this.currentTask.artifactId || !this.lockedCollectTarget) {
        this.lockedCollectTarget = { ...nextTask.target };
      }
      this.collectStuckSince = 0;
    } else if (nextTask.kind !== 'collect') {
      this.lockedCollectTarget = null;
    }

    if (this.currentTask.kind !== nextTask.kind || this.currentTask.artifactId !== nextTask.artifactId) {
      this.taskKindSince = this.elapsedSec;
      this.debugLog?.logTaskChange(
        obs.tick,
        this.elapsedSec,
        this.robotId,
        this.currentTask.kind,
        nextTask.kind,
        nextTask.artifactId
          ? `artifact=${nextTask.artifactId}`
          : `target=(${nextTask.target.x.toFixed(0)},${nextTask.target.y.toFixed(0)})`,
      );
    }

    const nextKey = taskKey(nextTask);
    const prevKey = taskKey(this.currentTask);
    if (nextKey === prevKey) {
      this.currentTask = {
        ...this.currentTask,
        targetHeading: nextTask.targetHeading,
        utility: nextTask.utility,
      };
    } else {
      this.currentTask = nextTask;
    }
    this.syncStableDisplayTarget();
  }

  private syncStableDisplayTarget(): void {
    const key = taskKey(this.currentTask);
    if (key !== this.stableTargetKey) {
      this.stableTargetKey = key;
      this.stableDisplayTarget = { ...this.currentTask.target };
    }
  }

  private resolveTask(obs: BotObservation): BotTaskGoal {
    const board = this.blackboards.forAlliance(obs.self.alliance);
    const decision = decideTask(
      obs,
      board,
      this.robotId,
      this.aimError,
      this.difficulty,
      this.currentTask,
      this.elapsedSec,
      this.taskKindSince,
    );

    if (this.currentTask.kind === 'collect' && this.currentTask.artifactId && this.lockedCollectTarget) {
      const artifact = obs.artifacts.find((entry) => entry.id === this.currentTask.artifactId);
      if (artifact?.phase === 'onField') {
        return {
          kind: 'collect',
          target: this.lockedCollectTarget,
          artifactId: this.currentTask.artifactId,
          goalNodeHint: this.currentTask.goalNodeHint,
          targetHeading: Math.atan2(
            artifact.pose.y - this.lockedCollectTarget.y,
            artifact.pose.x - this.lockedCollectTarget.x,
          ),
          utility: 5,
        };
      }
    }

    if (this.currentTask.kind === 'park' && shouldPark(obs) && !inBaseZone(obs)) {
      return this.currentTask;
    }

    return decision.task;
  }

  private nodePathKey(nodePath: string[]): string {
    return nodePath[nodePath.length - 1] ?? '';
  }

  private maybeReplan(obs: BotObservation, taskChanged: boolean): void {
    if (this.elapsedSec < this.replanCooldownUntil && !taskChanged) {
      return;
    }

    const profile = profileForDifficulty(this.difficulty);
    const stuckReplan = this.stuck.consumeForceReplan();
    const intervalElapsed = this.elapsedSec - this.lastPlanAt >= REPLAN_INTERVAL_SEC;
    const hintChanged = (this.currentTask.goalNodeHint ?? '') !== this.lastGoalHint;
    const goalMoved = hintChanged;

    let reason: BotReplanReason | null = null;
    if (taskChanged) reason = 'task_change';
    else if (stuckReplan) reason = 'stuck';
    else if (goalMoved) reason = 'goal_moved';
    else if (intervalElapsed) reason = 'interval';

    if (reason === 'interval' && Math.random() < profile.replanHesitationChance) {
      return;
    }
    if (!reason) return;

    if (stuckReplan) {
      this.replanCooldownUntil = this.elapsedSec + REPLAN_COOLDOWN_SEC;
    }

    const prevGoalNode = this.lastGoalGraphNode;
    const path = this.planner.replan(
      this.elapsedSec,
      obs.self.pose,
      this.currentTask.target,
      obs.self.alliance,
      { goalNodeHint: this.currentTask.goalNodeHint, force: taskChanged || stuckReplan || goalMoved },
    );
    const graphKey = this.nodePathKey(this.planner.nodePath);
    const routeChanged =
      graphKey !== prevGoalNode || taskChanged || stuckReplan || goalMoved;

    this.lastPlanAt = this.elapsedSec;
    this.lastGraphNodeKey = graphKey;
    this.lastGoalGraphNode = graphKey;

    if ((taskChanged || stuckReplan || goalMoved) && reason !== 'interval') {
      this.replanCount += 1;
      this.lastReplanReason = reason;
      this.debugLog?.logReplan(obs.tick, this.elapsedSec, this.robotId, reason, {
        task: this.currentTask.kind,
        target: `(${this.currentTask.target.x.toFixed(1)},${this.currentTask.target.y.toFixed(1)})`,
        hint: this.currentTask.goalNodeHint ?? null,
      });
    } else if (routeChanged && reason === 'interval') {
      this.lastReplanReason = reason;
    }

    const planMeta = this.planner.planMeta;
    if (planMeta && !planMeta.skipped) {
      this.debugLog?.logPlan(obs.tick, this.elapsedSec, this.robotId, 'graph path', {
        reason,
        start: planMeta.startNodeId,
        goal: planMeta.goalNodeId,
        nodes: planMeta.nodePath.join('→'),
        from: `(${planMeta.from.x.toFixed(1)},${planMeta.from.y.toFixed(1)})`,
        to: `(${planMeta.goal.x.toFixed(1)},${planMeta.goal.y.toFixed(1)})`,
        waypoints: path.length,
        polyline: path.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join('→'),
      });
    } else if (planMeta?.skipped && (taskChanged || stuckReplan || goalMoved)) {
      this.debugLog?.logPlan(obs.tick, this.elapsedSec, this.robotId, 'plan skipped', {
        reason: planMeta.skipReason,
        cachedWaypoints: this.planner.path.length,
      });
    }

    if (routeChanged || taskChanged || stuckReplan || goalMoved) {
      this.lastGoalHint = this.currentTask.goalNodeHint ?? '';
    }

    const pathKey = path.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join('|');
    if (pathKey !== this.stablePathKey) {
      this.stablePathKey = pathKey;
      this.stableDisplayPath = path.map((point) => ({ ...point }));
    }

    if (routeChanged) {
      const changed = this.navigator.followPath(path, this.currentTask.targetHeading);
      if (changed) {
        this.debugLog?.logMotion(obs.tick, this.elapsedSec, this.robotId, 'motion followPath', {
          waypoints: path.length,
          signature: this.navigator.pathSignature,
          goalHeading: this.currentTask.targetHeading ?? null,
        });
      }
    }
  }

  tick(world: BotWorldSnapshot, dt: number): BotDriveSample | null {
    if (!this.enabled) return null;

    const obs = buildObservation(world, this.robotId);
    if (!obs) return null;

    this.elapsedSec += dt;
    this.simNowMs = this.elapsedSec * 1000;
    this.reaction.setNowMs(this.simNowMs);

    if (!shouldBotDrive(obs)) {
      this.navigator.clear();
      this.planner.clear();
      this.stuck.reset();
      this.autoRunner.reset();
      this.pendingMechanism = {};
      this.reaction.clear();
      this.smoother.reset();
      this.lastDriveSource = 'motion';
      this.lastDebugState = {
        robotId: this.robotId,
        alliance: obs.self.alliance,
        aiVersion: 'v2',
        driveFrame: 'field',
        task: 'idle',
        target: { x: obs.self.pose.x, y: obs.self.pose.y },
        storedCount: obs.self.stored.length,
        inLaunchZone: false,
        aligned: false,
        atGoal: true,
        stuckPhase: 'normal',
        pathLength: 0,
        path: [],
        reactionMsRemaining: 0,
        replanCount: this.replanCount,
        lastReplanReason: this.lastReplanReason,
      };
      return brakeSample();
    }

    if (
      inCenterDwellZone(obs.self.pose) &&
      Math.hypot(obs.self.linear.x, obs.self.linear.y) < 8
    ) {
      this.centerDwellSec += dt;
    }

    const profile = profileForDifficulty(this.difficulty);
    this.decideAccumulator += dt;
    this.debugLogAccumulator += dt;

    if (this.planner.path.length === 0 && this.currentTask.kind !== 'idle') {
      this.maybeReplan(obs, true);
    }

    const isAutoPhase = obs.match.phase === 'auto' || obs.match.phase === 'transition';

    if (this.decideAccumulator >= 1 / 15) {
      this.decideAccumulator = 0;
      const board = this.blackboards.forAlliance(obs.self.alliance);
      board.releaseCollected(obs.artifacts);

      const prevTaskKey = taskKey(this.currentTask);
      const nextTask = this.resolveTask(obs);
      this.applyTaskChange(obs, nextTask);
      const taskChanged = taskKey(nextTask) !== prevTaskKey;

      if (isAutoPhase) {
        const routine = routineForRobot(this.robotId, obs.self.alliance);
        if (routine && !this.autoRunner.isRunning()) {
          this.autoRunner.start(routine);
        }
      } else {
        this.autoRunner.reset();
      }

      if (this.planner.path.length === 0 || taskChanged) {
        this.maybeReplan(obs, taskChanged);
      } else if (this.elapsedSec >= this.replanCooldownUntil) {
        this.maybeReplan(obs, false);
      }
    }

    if (
      this.currentTask.kind === 'collect' &&
      this.currentTask.artifactId &&
      this.stuck.isCollectStuck()
    ) {
      this.collectStuckSince += dt;
      if (this.collectStuckSince >= COLLECT_STUCK_RELEASE_SEC) {
        this.blackboards.forAlliance(obs.self.alliance).release(this.currentTask.artifactId);
        this.collectStuckSince = 0;
      }
    } else {
      this.collectStuckSince = 0;
    }

    const stuckInput = this.stuck.update(this.elapsedSec, obs.self.pose, dt);
    if (this.stuck.consumeStuckEntry()) {
      this.replanCooldownUntil = this.elapsedSec + REPLAN_COOLDOWN_SEC;
      if (this.stuck.consumeForceReplan()) {
        this.maybeReplan(obs, true);
      }
    }
    let driveSource: BotNavTrace['driveSource'] = 'motion';
    let driveInput: HolonomicInput;
    if (stuckInput) {
      driveSource = 'stuck';
      driveInput = stuckInput;
    } else if (isAutoPhase && this.autoRunner.isRunning()) {
      driveSource = 'auto';
      driveInput = this.autoRunner.update(obs.self.pose, obs.self.linear, dt, obs.limits);
    } else {
      const desiredMechPreview = mechanismForTask(obs, this.currentTask, false, this.aimError);
      driveInput = this.navigator.update(
        obs,
        this.currentTask,
        this.robotId,
        this.planner.path,
        dt,
        obs.maxAcceleration,
        Boolean(desiredMechPreview.reposition),
      );
    }
    this.lastDriveSource = driveSource;
    const driveRaw = { ...driveInput };

    const inLaunch = robotInLaunchZone(obs.self.pose, obs.footprint, obs.field);
    const scoringTask =
      this.currentTask.kind === 'score' || this.currentTask.kind === 'auto_hold';
    if (scoringTask && inLaunch && obs.self.stored.length > 0 && !stuckInput && !isAutoPhase) {
      driveSource = 'rotate';
      driveInput = fieldRotateToward(obs.self.pose, headingTowardBasin(obs) + this.aimError);
      this.lastDriveSource = driveSource;
    }

    if (this.currentTask.kind === 'collect' && this.currentTask.targetHeading !== undefined && !stuckInput) {
      const err = normalizeAngle(this.currentTask.targetHeading - obs.self.pose.heading);
      const dist = Math.hypot(
        this.currentTask.target.x - obs.self.pose.x,
        this.currentTask.target.y - obs.self.pose.y,
      );
      if (dist < 16 && Math.abs(err) > 0.1) {
        driveInput = {
          ...driveInput,
          forward: Math.min(driveInput.forward, 0.35),
          turn: Math.max(-1, Math.min(1, err * 3)),
        };
      }
    }

    driveInput = applyLocalAvoidance(
      driveInput,
      obs.self.pose,
      world.robots,
      this.robotId,
      world.barriers,
      obs.self.alliance,
      { selfTaskKind: this.currentTask.kind },
    );
    const driveAfterAvoid = { ...driveInput };

    driveInput = applyBarrierSlide(
      driveInput,
      obs.self.pose,
      obs.footprint,
      world.barriers,
    );
    const driveAfterBarrier = { ...driveInput };

    const smoothed = this.smoother.smooth(
      { forward: driveInput.forward, strafe: driveInput.strafe ?? 0, turn: driveInput.turn ?? 0 },
      dt,
      profile.inputSmoothingTau,
    );

    const atGoal = this.navigator.isAtGoal(obs.self.pose, this.currentTask.target, 5);
    const trajDebug = this.navigator.getDebug(obs.self.pose);
    const planMeta = this.planner.planMeta;
    const motionGoal = this.navigator.goal;
    const distTask = Math.hypot(
      this.currentTask.target.x - obs.self.pose.x,
      this.currentTask.target.y - obs.self.pose.y,
    );

    const navBase: Omit<BotNavTrace, 'flags'> = {
      pose: {
        x: +obs.self.pose.x.toFixed(2),
        y: +obs.self.pose.y.toFixed(2),
        heading: +obs.self.pose.heading.toFixed(3),
      },
      velocity: {
        x: +obs.self.linear.x.toFixed(2),
        y: +obs.self.linear.y.toFixed(2),
        speed: +Math.hypot(obs.self.linear.x, obs.self.linear.y).toFixed(2),
      },
      taskTarget: { ...this.currentTask.target },
      rawTaskTarget: { ...(this.stableDisplayTarget ?? this.currentTask.target) },
      motionGoal: motionGoal ? { ...motionGoal } : null,
      pursuitTarget: trajDebug.pursuitTarget,
      waypointIndex: trajDebug.waypointIndex,
      pathLength: trajDebug.pathLength,
      distTask: +distTask.toFixed(2),
      distGoal: +trajDebug.distToGoal.toFixed(2),
      distPursuit: +trajDebug.distToPursuit.toFixed(2),
      startNode: planMeta?.startNodeId ?? this.lastGraphNodeKey ?? '?',
      goalNode: planMeta?.goalNodeId ?? this.lastGoalGraphNode ?? '?',
      nodePath: planMeta?.nodePath ?? this.planner.nodePath,
      pathSignature: this.navigator.pathSignature || this.stablePathKey,
      driveSource,
      driveRaw: driveVec(driveRaw),
      driveAvoid: driveVec(driveAfterAvoid),
      driveBarrier: driveVec(driveAfterBarrier),
      driveFinal: driveVec(smoothed),
    };
    const navTrace: BotNavTrace = {
      ...navBase,
      flags: buildNavFlags(this.currentTask, navBase, atGoal, this.stuck.phaseName),
    };
    this.lastNavTrace = navTrace;

    this.debugLog?.logNavTrace(obs.tick, this.elapsedSec, this.robotId, navTrace, NAV_TRACE_INTERVAL_SEC);

    const desiredMech = mechanismForTask(obs, this.currentTask, atGoal, this.aimError);
    const aligned = isAlignedForShot(obs);

    const scoringNow = Boolean(desiredMech.shootHeld);
    if (scoringNow) {
      this.pendingMechanism = desiredMech;
      this.reaction.clear();
    } else {
      const released = this.reaction.tick(this.simNowMs);
      if (released) {
        this.pendingMechanism = released;
      } else if (this.reaction.hasPending()) {
        // wait
      } else if (
        (desiredMech.intake !== this.pendingMechanism.intake ||
          desiredMech.shootHeld !== this.pendingMechanism.shootHeld ||
          desiredMech.gateEdge !== this.pendingMechanism.gateEdge) &&
        (desiredMech.intake || desiredMech.shootHeld || desiredMech.gateEdge)
      ) {
        this.reaction.queueMechanism(this.simNowMs, profile, desiredMech);
      } else if (!desiredMech.intake && !desiredMech.shootHeld && !desiredMech.gateEdge) {
        this.pendingMechanism = {};
      }
    }

    const mech = this.pendingMechanism;
    const isAutoPedro =
      isAutoPhase && this.autoRunner.isRunning() && !stuckInput;
    const driveFrame = isAutoPedro ? 'robot' : 'field';

    this.lastDebugState = {
      robotId: this.robotId,
      alliance: obs.self.alliance,
      aiVersion: 'v2',
      driveFrame,
      task: this.currentTask.kind,
      target: this.stableDisplayTarget ?? this.currentTask.target,
      artifactId: this.currentTask.artifactId,
      storedCount: obs.self.stored.length,
      inLaunchZone: inLaunch,
      aligned,
      atGoal,
      stuckPhase: this.stuck.phaseName,
      pathLength: this.stableDisplayPath.length,
      path: this.stableDisplayPath.map((point) => ({ ...point })),
      reactionMsRemaining: this.reaction.msRemaining,
      lastReplanReason: this.lastReplanReason,
      replanCount: this.replanCount,
      nav: navTrace,
    };

    if (this.debugLog && this.debugLogAccumulator >= DEBUG_LOG_INTERVAL_SEC) {
      this.debugLogAccumulator = 0;
      this.debugLog.logState(obs.tick, this.elapsedSec, this.lastDebugState);
    }

    return {
      input: {
        forward: smoothed.forward,
        strafe: smoothed.strafe,
        turn: smoothed.turn,
        brake: driveInput.brake,
        endpointBrake: driveInput.endpointBrake,
      },
      driveFrame,
      mechanism: {
        command: {
          intake: mech.intake,
          shoot: mech.shoot ?? mech.shootHeld,
          gate: mech.gate,
        },
        shootEdge: mech.shootEdge ?? false,
        gateEdge: mech.gateEdge ?? false,
        shootHeld: mech.shootHeld ?? false,
      },
    };
  }

  getDebugState(): BotDebugState {
    return (
      this.lastDebugState ?? {
        robotId: this.robotId,
        alliance: 'blue',
        aiVersion: 'v2',
        driveFrame: 'field',
        task: this.currentTask.kind,
        target: this.currentTask.target,
        artifactId: this.currentTask.artifactId,
        storedCount: 0,
        inLaunchZone: false,
        aligned: false,
        atGoal: false,
        stuckPhase: this.stuck.phaseName,
        pathLength: this.stableDisplayPath.length,
        path: this.stableDisplayPath.map((point) => ({ ...point })),
        reactionMsRemaining: this.reaction.msRemaining,
        replanCount: this.replanCount,
        lastReplanReason: this.lastReplanReason,
      }
    );
  }

  reset(): void {
    this.elapsedSec = 0;
    this.simNowMs = 0;
    this.decideAccumulator = 0;
    this.debugLogAccumulator = 0;
    this.lastPlanAt = 0;
    this.collectStuckSince = 0;
    this.replanCount = 0;
    this.centerDwellSec = 0;
    this.lastReplanReason = undefined;
    this.lastGraphNodeKey = '';
    this.lastGoalGraphNode = '';
    this.lastGoalHint = '';
    this.replanCooldownUntil = 0;
    this.lockedCollectTarget = null;
    this.navigator.clear();
    this.planner.clear();
    this.stuck.reset();
    this.smoother.reset();
    this.reaction.clear();
    this.autoRunner.reset();
    this.pendingMechanism = {};
    this.currentTask = { kind: 'idle', target: { x: 72, y: 72 }, utility: 0 };
    this.stableDisplayPath = [];
    this.stablePathKey = '';
    this.stableDisplayTarget = null;
    this.stableTargetKey = '';
    this.taskKindSince = 0;
    this.lastDebugState = null;
    this.lastNavTrace = undefined;
    this.lastDriveSource = 'motion';
  }
}
