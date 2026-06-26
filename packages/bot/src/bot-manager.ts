import { AutoSequenceRunner } from '@ftc-sim/pedro';
import { BotDebugLog, type BotDebugLogEntry } from './debug/bot-debug-log.js';
import {
  pathOverlayPoints,
  startBotAutoRunner,
  tickBotAutoRunner,
} from './auto/bot-auto-path.js';
import { pickEndgameRoles, pickGateAssignees } from './coordination.js';
import {
  applyBotAvoidance,
  applyBotAutoDriveAvoidance,
  detectOpponentInSecretTunnel,
} from './navigation/avoidance.js';
import {
  createCollectorState,
  tickSimpleCollector,
  type CollectorRobotState,
} from './simple-collector.js';
import type {
  BotAutoPath,
  BotDebugState,
  BotDriveSample,
  BotMetrics,
  BotSlotConfig,
  BotTaskKind,
  BotWorldSnapshot,
  Difficulty,
} from './types.js';
import { BOT_AI_VERSION } from './types.js';

interface BotAutoRunnerState {
  runner: AutoSequenceRunner;
  loadId: number;
}

interface AutoStallWatch {
  completion: number;
  distToTarget: number;
  ticks: number;
  lastLogSec: number;
}

function idleHoldInput(): import('@ftc-sim/robot').HolonomicInput {
  return { forward: 0, strafe: 0, turn: 0 };
}

export class BotManager {
  private slots: BotSlotConfig[] = [];
  private collectorState = new Map<string, CollectorRobotState>();
  private autoRunners = new Map<string, BotAutoRunnerState>();
  private autoStallWatch = new Map<string, AutoStallWatch>();
  private autoStepWatch = new Map<string, number>();
  private lastDebugStates = new Map<string, BotDebugState>();
  private debugLog = new BotDebugLog(400, true);
  private lastMatchPhase: BotWorldSnapshot['match']['phase'] = 'setup';

  setDebugLogging(enabled: boolean): void {
    this.debugLog.setEnabled(enabled);
  }

  getDebugLogs(): BotDebugLogEntry[] {
    return this.debugLog.getEntries();
  }

  setSlots(slots: BotSlotConfig[]): void {
    this.slots = slots;
    const enabledIds = new Set(
      slots.filter((slot) => slot.enabled).map((slot) => slot.robotId),
    );
    for (const id of [...this.collectorState.keys()]) {
      if (!enabledIds.has(id as BotSlotConfig['robotId'])) this.collectorState.delete(id);
    }
    for (const id of [...this.autoRunners.keys()]) {
      if (!enabledIds.has(id as BotSlotConfig['robotId'])) this.autoRunners.delete(id);
    }
    for (const id of [...this.autoStallWatch.keys()]) {
      if (!enabledIds.has(id as BotSlotConfig['robotId'])) this.autoStallWatch.delete(id);
    }
    for (const id of [...this.autoStepWatch.keys()]) {
      if (!enabledIds.has(id as BotSlotConfig['robotId'])) this.autoStepWatch.delete(id);
    }
  }

  getSlots(): BotSlotConfig[] {
    return [...this.slots];
  }

  getMetrics(): Record<string, BotMetrics> {
    return {};
  }

  tick(world: BotWorldSnapshot, dt: number): Map<string, BotDriveSample> {
    const outputs = new Map<string, BotDriveSample>();
    const elapsedSec = world.match.timeElapsed;
    const phase = world.match.phase;

    if (
      (this.lastMatchPhase === 'auto' || this.lastMatchPhase === 'transition') &&
      phase !== 'auto' &&
      phase !== 'transition'
    ) {
      for (const entry of this.autoRunners.values()) {
        entry.runner.cancelPath();
      }
      this.autoRunners.clear();
    }
    this.lastMatchPhase = phase;

    const allyTasks = new Map<string, BotTaskKind>();
    for (const [id, debug] of this.lastDebugStates) {
      allyTasks.set(id, debug.task);
    }

    const gateAssignees = pickGateAssignees(
      world,
      this.slots,
      allyTasks,
      world.match.infiniteMode ? undefined : world.match.timeRemainingInPhase,
    );

    const endgameRoles = pickEndgameRoles(world, this.slots, allyTasks);

    const allyLaunchZones = new Map<string, 'near' | 'far'>();
    const allyArtifactIds = new Map<string, string>();
    for (const [id, debug] of this.lastDebugStates) {
      const goalNode = debug.nav?.goalNode ?? '';
      if (debug.task === 'score' && goalNode.startsWith('launch_')) {
        const zone = goalNode.replace('launch_', '') as 'near' | 'far';
        if (zone === 'near' || zone === 'far') {
          allyLaunchZones.set(id, zone);
        }
      }
      if (debug.artifactId && (debug.task === 'collect' || debug.task === 'idle')) {
        allyArtifactIds.set(id, debug.artifactId);
      }
    }

    const collectorCtx = {
      gateAssignees,
      allyLaunchZones,
      allyArtifactIds,
      endgameRoles,
      allyTasks,
    };

    for (const slot of this.slots) {
      if (!slot.enabled) continue;
      if (world.humanInputRobotIds.has(slot.robotId)) continue;

      let state = this.collectorState.get(slot.robotId);
      if (!state) {
        state = createCollectorState();
        this.collectorState.set(slot.robotId, state);
      }

      const robot = world.robots.find((entry) => entry.id === slot.robotId);
      const inAutoPeriod = phase === 'auto' || phase === 'transition';
      const autoSample = inAutoPeriod
        ? this.tickAutoPath(world, slot, robot, dt)
        : null;
      let result: { sample: BotDriveSample; debug: BotDebugState; logLines: string[] };
      if (autoSample) {
        result = autoSample;
      } else if (inAutoPeriod) {
        result = this.matchPhaseHoldResult(slot, robot, slot.autoPath);
      } else {
        result = tickSimpleCollector(world, slot, state, collectorCtx);
      }
      if (robot) {
        const task = result.debug.task;
        const gateInLane = task === 'gate' && result.debug.gatePhase === 'lane';
        if (task === 'auto_drive' || task === 'auto_hold') {
          const avoidedInput = applyBotAutoDriveAvoidance(
            result.sample.input,
            robot.pose,
            world.robots,
            slot.robotId,
            robot.alliance,
            result.sample.driveFrame ?? 'robot',
            allyTasks,
          );
          result.sample.input = avoidedInput;
        } else {
          const skipAvoidance = task === 'gate' && !gateInLane;
          if (!skipAvoidance) {
            const avoidedInput = applyBotAvoidance(
              result.sample.input,
              robot.pose,
              world.robots,
              slot.robotId,
              robot.alliance,
              world.field,
              task,
              detectOpponentInSecretTunnel(world.robots, robot.alliance, world.field),
              result.sample.driveFrame ?? 'field',
              allyTasks,
              gateAssignees,
            );
            result.sample.input = avoidedInput;
            if (result.debug.nav) {
              result.debug.nav.driveAvoid = {
                f: avoidedInput.forward,
                s: avoidedInput.strafe,
                t: avoidedInput.turn,
              };
              result.debug.nav.driveFinal = result.debug.nav.driveAvoid;
            }
          }
        }
      }

      outputs.set(slot.robotId, result.sample);
      this.lastDebugStates.set(slot.robotId, result.debug);

      for (const line of result.logLines) {
        const level =
          line.startsWith('PARK') || line.startsWith('EMPTY') || line.startsWith('FULL')
            ? 'task'
            : 'info';
        const category =
          line.startsWith('WAIT') || line.includes('drive=blocked') ? 'warn' : 'state';
        this.debugLog.log(
          world.tickIndex,
          elapsedSec,
          slot.robotId,
          category,
          level,
          line,
        );
      }
    }

    return outputs;
  }

  private tickAutoPath(
    world: BotWorldSnapshot,
    slot: BotSlotConfig,
    robot: BotWorldSnapshot['robots'][number] | undefined,
    dt: number,
  ): { sample: BotDriveSample; debug: BotDebugState; logLines: string[] } | null {
    if (!slot.runAuto || !slot.autoPath) {
      return null;
    }

    const phase = world.match.phase;
    if (phase !== 'auto' && phase !== 'transition') {
      return null;
    }
    if (!robot || !world.match.running || world.match.paused) {
      return null;
    }

    const autoPath = slot.autoPath;

    if (phase === 'transition') {
      return this.autoHoldResult(slot, robot, autoPath, 'transition');
    }

    let entry = this.autoRunners.get(slot.robotId);
    if (!entry || entry.loadId !== autoPath.loadId) {
      const runner = new AutoSequenceRunner();
      startBotAutoRunner(runner, autoPath, robot.alliance, robot.pose, world.robotMass);
      entry = { runner, loadId: autoPath.loadId };
      this.autoRunners.set(slot.robotId, entry);
    }

    const runner = entry.runner;
    const input = tickBotAutoRunner(runner, robot.pose, robot.linear, dt, world.limits);

    const running = runner.isRunning();
    const inWait = runner.shouldAutoShoot();
    const runnerDebug = runner.getRunnerDebug();
    const pathPoints = pathOverlayPoints(autoPath, robot.alliance);
    const targetPose = runner.getTargetPose();
    const progress = runner.getProgress();
    const errors = runner.getErrors();
    const distToTarget = targetPose
      ? Math.hypot(targetPose.x - robot.pose.x, targetPose.y - robot.pose.y)
      : 0;
    const logLines: string[] = [];

    const lastStep = this.autoStepWatch.get(slot.robotId) ?? -1;
    if (runnerDebug.stepIndex !== lastStep) {
      this.autoStepWatch.set(slot.robotId, runnerDebug.stepIndex);
      if (runnerDebug.phase === 'wait') {
        logLines.push(
          `AUTO wait step=${runnerDebug.stepIndex + 1}/${runnerDebug.stepCount} shoot ${runnerDebug.waitRemainingSec.toFixed(2)}s @ (${robot.pose.x.toFixed(0)},${robot.pose.y.toFixed(0)})`,
        );
      } else if (runnerDebug.phase === 'path') {
        logLines.push(
          `AUTO path step=${runnerDebug.stepIndex + 1}/${runnerDebug.stepCount} endDist=${runnerDebug.segmentEndDist?.toFixed(1) ?? '?'}`,
        );
      }
    }

    let stall = this.autoStallWatch.get(slot.robotId);
    if (!stall) {
      stall = {
        completion: progress.completion,
        distToTarget,
        ticks: 0,
        lastLogSec: -Infinity,
      };
      this.autoStallWatch.set(slot.robotId, stall);
    }
    const completionDelta = Math.abs(progress.completion - stall.completion);
    const distDelta = Math.abs(distToTarget - stall.distToTarget);
    if (running && !inWait && runnerDebug.phase === 'path' && completionDelta < 0.002 && distDelta < 0.15) {
      stall.ticks += 1;
    } else {
      stall.ticks = 0;
      stall.completion = progress.completion;
      stall.distToTarget = distToTarget;
    }
    if (
      stall.ticks >= 90 &&
      stall.lastLogSec < world.match.timeElapsed - 2 &&
      distToTarget > 2.5
    ) {
      stall.lastLogSec = world.match.timeElapsed;
      logLines.push(
        `AUTO stuck step=${runnerDebug.stepIndex + 1}/${runnerDebug.stepCount} pose=(${robot.pose.x.toFixed(1)},${robot.pose.y.toFixed(1)}) target=(${targetPose?.x.toFixed(1) ?? '?'},${targetPose?.y.toFixed(1) ?? '?'}) segEnd=${runnerDebug.segmentEndDist?.toFixed(1) ?? '?'} t=${progress.tValue.toFixed(2)} transErr=${errors.translational.toFixed(1)} drive=${(Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.turn)).toFixed(2)} brake=${input.brake ? 'yes' : 'no'}`,
      );
    }

    if (!running) {
      this.autoStallWatch.delete(slot.robotId);
      return this.autoHoldResult(slot, robot, autoPath, 'auto_done');
    }

    return {
      sample: {
        input,
        driveFrame: 'robot',
        mechanism: {
          command: { intake: 1 },
          shootEdge: false,
          gateEdge: false,
          shootHeld: runner.shouldAutoShoot(),
        },
      },
      debug: {
        robotId: slot.robotId,
        alliance: robot.alliance,
        aiVersion: BOT_AI_VERSION,
        driveFrame: 'robot',
        task: 'auto_drive',
        target: targetPose ? { x: targetPose.x, y: targetPose.y } : null,
        storedCount: robot.stored.length,
        inLaunchZone: false,
        aligned: false,
        atGoal: false,
        stuckPhase: inWait ? 'auto-wait' : 'normal',
        autoPhase: runnerDebug.phase === 'wait' ? 'wait' : runnerDebug.phase === 'path' ? 'path' : 'idle',
        autoStep: runnerDebug.stepIndex + 1,
        autoStepCount: runnerDebug.stepCount,
        autoSegmentEndDist: runnerDebug.segmentEndDist,
        pathLength: pathPoints.length,
        path: pathPoints,
        reactionMsRemaining: 0,
      },
      logLines,
    };
  }

  private matchPhaseHoldResult(
    slot: BotSlotConfig,
    robot: BotWorldSnapshot['robots'][number] | undefined,
    autoPath: BotAutoPath | null,
  ): { sample: BotDriveSample; debug: BotDebugState; logLines: string[] } {
    const alliance =
      robot?.alliance ??
      (slot.robotId === 'red-far' || slot.robotId === 'red-near' ? 'red' : 'blue');
    const pathPoints =
      autoPath && robot ? pathOverlayPoints(autoPath, robot.alliance) : [];
    return {
      sample: {
        input: idleHoldInput(),
        driveFrame: 'robot',
        mechanism: {
          command: {},
          shootEdge: false,
          gateEdge: false,
          shootHeld: false,
        },
      },
      debug: {
        robotId: slot.robotId,
        alliance,
        aiVersion: BOT_AI_VERSION,
        driveFrame: 'robot',
        task: 'auto_hold',
        target: null,
        storedCount: robot?.stored.length ?? 0,
        inLaunchZone: false,
        aligned: true,
        atGoal: true,
        stuckPhase: 'normal',
        pathLength: pathPoints.length,
        path: pathPoints,
        reactionMsRemaining: 0,
      },
      logLines: [],
    };
  }

  private autoHoldResult(
    slot: BotSlotConfig,
    robot: BotWorldSnapshot['robots'][number],
    autoPath: BotAutoPath,
    reason: 'transition' | 'auto_done',
  ): { sample: BotDriveSample; debug: BotDebugState; logLines: string[] } {
    const pathPoints = pathOverlayPoints(autoPath, robot.alliance);
    const target = pathPoints[pathPoints.length - 1] ?? null;
    return {
      sample: {
        input: idleHoldInput(),
        driveFrame: 'robot',
        mechanism: {
          command: {},
          shootEdge: false,
          gateEdge: false,
          shootHeld: false,
        },
      },
      debug: {
        robotId: slot.robotId,
        alliance: robot.alliance,
        aiVersion: BOT_AI_VERSION,
        driveFrame: 'robot',
        task: 'auto_hold',
        target: target ? { x: target.x, y: target.y } : null,
        storedCount: robot.stored.length,
        inLaunchZone: false,
        aligned: true,
        atGoal: true,
        stuckPhase: 'normal',
        pathLength: pathPoints.length,
        path: pathPoints,
        reactionMsRemaining: 0,
      },
      logLines:
        reason === 'transition'
          ? []
          : [`AUTO done path=${autoPath.label} hold`],
    };
  }

  getDebugStates(): BotDebugState[] {
    return this.slots
      .filter((slot) => slot.enabled)
      .map((slot) => this.lastDebugStates.get(slot.robotId))
      .filter((state): state is BotDebugState => state !== undefined);
  }

  isBotControlled(robotId: string): boolean {
    return this.slots.some((slot) => slot.enabled && slot.robotId === robotId);
  }

  reset(): void {
    this.collectorState.clear();
    for (const entry of this.autoRunners.values()) {
      entry.runner.cancelPath();
    }
    this.autoRunners.clear();
    this.autoStallWatch.clear();
    this.autoStepWatch.clear();
    this.lastDebugStates.clear();
    this.debugLog.clear();
    this.lastMatchPhase = 'setup';
  }
}

export function defaultPracticeBotSlots(difficulty: Difficulty = 'normal'): BotSlotConfig[] {
  return [
    {
      robotId: 'blue-near',
      enabled: true,
      difficulty,
      runAuto: false,
      autoPath: null,
    },
    {
      robotId: 'red-far',
      enabled: true,
      difficulty,
      runAuto: false,
      autoPath: null,
    },
    {
      robotId: 'red-near',
      enabled: true,
      difficulty,
      runAuto: false,
      autoPath: null,
    },
  ];
}

export type { BotDebugLogEntry };
