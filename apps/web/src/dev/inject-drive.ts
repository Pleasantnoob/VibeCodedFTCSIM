import type { MatchSnapshot } from '@ftc-sim/match';
import type { PathChain, PedroJsonFile } from '@ftc-sim/pedro';
import { pathChainToPoints } from '@ftc-sim/pedro';
import type { AutoSequenceRunner } from '@ftc-sim/pedro';
import type { HolonomicInput, Pose } from '@ftc-sim/robot';
import type { BotDebugState } from '@ftc-sim/bot';

export interface DriveTelemetryFrame {
  input: HolonomicInput;
  linear: { x: number; y: number };
  angular: number;
  pose: Pose;
  speed: number;
}

export interface GoalCollisionReport {
  maxJump: number;
  headingDelta: number;
  anyCornerInside: boolean;
  frameCount: number;
  finalPose: Pose;
  skipSpikes?: number;
  medianStep?: number;
}

export type FtcSimScenarioName =
  | 'northPulse'
  | 'strafePulse'
  | 'rotatePulse'
  | 'goalCornerPivotBlue'
  | 'goalWallSlideBlue'
  | 'goalRamRed'
  | 'goalStationaryPivotBlue';

export interface FtcSimSnapshot {
  phase: MatchSnapshot['phase'];
  timeElapsed: number;
  phaseTime: number;
  allowsDrive: boolean;
  controlSource: MatchSnapshot['controlSource'];
  paused: boolean;
  running: boolean;
  pose: Pose;
  speed: number;
}

export interface FtcSimPathSnapshot {
  pointCount: number;
  totalLength: number;
  firstPoint: { x: number; y: number } | null;
  lastPoint: { x: number; y: number } | null;
  segmentCount: number;
}

export interface FtcSimFollowerSnapshot {
  busy: boolean;
  errors: { translational: number; heading: number; drive: number };
  progress: { completion: number; distanceRemaining: number; pathIndex: number };
  targetPose: Pose | null;
}

export interface BotSmokeBotReport {
  startPose: Pose;
  endPose: Pose;
  distanceMoved: number;
  replanDelta: number;
  maxStored: number;
  tasksSeen: string[];
  badFlags: string[];
  sustainedBadFlags: boolean;
  inLaunchZone: boolean;
}

export interface BotSmokeReport {
  durationSec: number;
  bots: Record<string, BotSmokeBotReport>;
  pass: boolean;
  failures: string[];
}

export interface BotSmokeTestOptions {
  durationSec?: number;
  mode?: 'inf' | 'teleop' | 'current';
  minDistanceMoved?: number;
  maxReplanDelta?: number;
  minMaxStored?: number;
  forbidFlags?: string[];
}

export interface FtcSimDevApi {
  injectInput: (input: HolonomicInput) => void;
  clearInput: () => void;
  resetGamepad: () => void;
  runScenario: (name: FtcSimScenarioName) => Promise<GoalCollisionReport | void>;
  getTelemetry: () => DriveTelemetryFrame[];
  /** Dev inject bypasses match teleop gating for collision scenarios. */
  snapshot: () => FtcSimSnapshot;
  loadPathJson: (json: PedroJsonFile) => void;
  loadPathFile: (text: string) => void;
  getPathSnapshot: () => FtcSimPathSnapshot | null;
  clearPath: () => void;
  getFollowerSnapshot: () => FtcSimFollowerSnapshot | null;
  startAuto: () => void;
  getBotDebug: () => BotDebugState[];
  getNpcPoses: () => Array<{ id: string; pose: Pose; linear: { x: number; y: number } }>;
  runBotSmokeTest: (opts?: BotSmokeTestOptions) => Promise<BotSmokeReport>;
}

declare global {
  interface Window {
    __ftcSim?: FtcSimDevApi;
  }
}

const SCENARIOS: Record<FtcSimScenarioName, { on: HolonomicInput; framesOn: number; framesOff: number }> = {
  northPulse: {
    on: { forward: 1, strafe: 0, turn: 0 },
    framesOn: 120,
    framesOff: 240,
  },
  strafePulse: {
    on: { forward: 0, strafe: -1, turn: 0 },
    framesOn: 120,
    framesOff: 240,
  },
  rotatePulse: {
    on: { forward: 0, strafe: 0, turn: 1 },
    framesOn: 90,
    framesOff: 240,
  },
  goalCornerPivotBlue: {
    on: { forward: 1, strafe: -0.35, turn: 0 },
    framesOn: 360,
    framesOff: 120,
  },
  goalWallSlideBlue: {
    on: { forward: 0.6, strafe: -1, turn: 0 },
    framesOn: 360,
    framesOff: 120,
  },
  goalRamRed: {
    on: { forward: 1, strafe: 0.35, turn: 0 },
    framesOn: 360,
    framesOff: 120,
  },
  goalStationaryPivotBlue: {
    on: { forward: 1, strafe: -0.25, turn: 0 },
    framesOn: 360,
    framesOff: 120,
  },
};

const BLUE_GOAL = [
  { x: 6, y: 119 },
  { x: 25, y: 144 },
  { x: 0, y: 144 },
  { x: 0, y: 70 },
  { x: 7, y: 70 },
];

function pointInPolygon(point: { x: number; y: number }, polygon: typeof BLUE_GOAL): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function robotSamplePoints(pose: Pose): { x: number; y: number }[] {
  const half = 9;
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  const locals = [
    { x: half, y: half },
    { x: half, y: -half },
    { x: -half, y: -half },
    { x: -half, y: half },
  ];
  return locals.map((local) => ({
    x: pose.x + local.x * cos - local.y * sin,
    y: pose.y + local.x * sin + local.y * cos,
  }));
}

function summarizeGoalCollision(telemetry: DriveTelemetryFrame[]): GoalCollisionReport {
  if (telemetry.length === 0) {
    return {
      maxJump: 0,
      headingDelta: 0,
      anyCornerInside: false,
      frameCount: 0,
      finalPose: { x: 0, y: 0, heading: 0 },
    };
  }

  let maxJump = 0;
  let anyCornerInside = false;
  const steps: number[] = [];
  for (let i = 1; i < telemetry.length; i++) {
    const prev = telemetry[i - 1].pose;
    const next = telemetry[i].pose;
    const step = Math.hypot(next.x - prev.x, next.y - prev.y);
    steps.push(step);
    maxJump = Math.max(maxJump, step);
    for (const point of robotSamplePoints(next)) {
      if (pointInPolygon(point, BLUE_GOAL)) {
        anyCornerInside = true;
        break;
      }
    }
  }

  const first = telemetry[0].pose;
  const finalPose = telemetry[telemetry.length - 1].pose;
  steps.sort((a, b) => a - b);
  const medianStep = steps.length > 0 ? steps[Math.floor(steps.length / 2)] : 0;
  const skipSpikes = steps.filter((s) => s > medianStep * 2.5 + 0.05).length;

  return {
    maxJump,
    headingDelta: Math.abs(finalPose.heading - first.heading),
    anyCornerInside,
    frameCount: telemetry.length,
    finalPose,
    skipSpikes,
    medianStep,
  };
}

const BOT_NPC_IDS = ['blue-near', 'red-far', 'red-near'] as const;
const DEFAULT_BAD_FLAGS = ['stuck_backoff', 'stuck_rotate', 'idle_drive_far_from_target', 'no_path'];

async function sleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

const SIM_HZ = 120;

async function waitForBotHarnessReady(hooks: {
  getNpcPoses: () => Array<{ id: string }>;
  getMatchSnapshot: () => MatchSnapshot;
  stepSimulation?: (steps: number) => void;
  startInfinitePractice?: () => void;
  startTimedAuto?: () => void;
  mode: 'inf' | 'teleop' | 'current';
}): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (hooks.getNpcPoses().length >= BOT_NPC_IDS.length) break;
    await sleepMs(100);
  }

  if (hooks.mode === 'inf') {
    hooks.startInfinitePractice?.();
  } else if (hooks.mode === 'teleop') {
    hooks.startTimedAuto?.();
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    const snap = hooks.getMatchSnapshot();
    if (snap.running && !snap.paused && (snap.allowsDrive || snap.phase === 'auto')) {
      break;
    }
    await sleepMs(50);
  }
}

function collectBadFlags(debug: BotDebugState): string[] {
  return debug.nav?.flags ?? [];
}

function evaluateBotSmoke(
  samples: Array<{ debug: BotDebugState[]; npcs: ReturnType<FtcSimDevApi['getNpcPoses']> }>,
  durationSec: number,
  opts: BotSmokeTestOptions,
  startPoses?: Record<string, Pose>,
): BotSmokeReport {
  const failures: string[] = [];
  const bots: Record<string, BotSmokeBotReport> = {};
  const minDistance = opts.minDistanceMoved ?? 5;
  const maxReplan = opts.maxReplanDelta ?? 15;
  const minStored = opts.minMaxStored ?? 0;
  const forbidFlags = opts.forbidFlags ?? DEFAULT_BAD_FLAGS;

  for (const id of BOT_NPC_IDS) {
    const startNpc = samples[0]?.npcs.find((npc) => npc.id === id);
    const endNpc = samples[samples.length - 1]?.npcs.find((npc) => npc.id === id);
    const startPose = startPoses?.[id] ?? startNpc?.pose ?? { x: 0, y: 0, heading: 0 };
    const endPose = endNpc?.pose ?? startPose;
    let distanceMoved = Math.hypot(endPose.x - startPose.x, endPose.y - startPose.y);

    let startReplans = 0;
    let endReplans = 0;
    let maxStored = 0;
    const tasksSeen = new Set<string>();
    const flagCounts = new Map<string, number>();
    let inLaunchZone = false;

    for (const sample of samples) {
      const debug = sample.debug.find((entry) => entry.robotId === id);
      if (!debug) continue;
      tasksSeen.add(debug.task);
      maxStored = Math.max(maxStored, debug.storedCount);
      if (debug.inLaunchZone) inLaunchZone = true;
      for (const flag of collectBadFlags(debug)) {
        flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
      }
      const npc = sample.npcs.find((entry) => entry.id === id);
      if (npc) {
        distanceMoved = Math.max(
          distanceMoved,
          Math.hypot(npc.pose.x - startPose.x, npc.pose.y - startPose.y),
        );
      }
    }

    const firstDebug = samples[0]?.debug.find((entry) => entry.robotId === id);
    const lastDebug = samples[samples.length - 1]?.debug.find((entry) => entry.robotId === id);
    startReplans = firstDebug?.replanCount ?? 0;
    endReplans = lastDebug?.replanCount ?? 0;
    const replanDelta = Math.max(0, endReplans - startReplans);

    const badFlags = [...flagCounts.keys()].filter((flag) => forbidFlags.includes(flag));
    const sustainedBadFlags =
      samples.length > 0 &&
      forbidFlags.some((flag) => (flagCounts.get(flag) ?? 0) / samples.length > 0.5);

    bots[id] = {
      startPose,
      endPose,
      distanceMoved,
      replanDelta,
      maxStored,
      tasksSeen: [...tasksSeen],
      badFlags,
      sustainedBadFlags,
      inLaunchZone,
    };

    if (distanceMoved < minDistance) {
      failures.push(`${id}: moved ${distanceMoved.toFixed(1)}in (need ${minDistance}in)`);
    }
    if (replanDelta > maxReplan) {
      failures.push(`${id}: replans +${replanDelta} (max ${maxReplan})`);
    }
    if (sustainedBadFlags) {
      failures.push(`${id}: sustained bad flags ${badFlags.join(', ')}`);
    }
  }

  const anyStored = Object.values(bots).some((bot) => bot.maxStored >= minStored);
  if (minStored > 0 && !anyStored) {
    failures.push(`no bot reached stored >= ${minStored}`);
  }

  return {
    durationSec,
    bots,
    pass: failures.length === 0,
    failures,
  };
}

export function installFtcSimDevApi(hooks: {
  setInjectInput: (input: HolonomicInput | null) => void;
  getTelemetry: () => DriveTelemetryFrame[];
  resetGamepad?: () => void;
  resetRobot?: (pose?: Pose) => void;
  getMatchSnapshot: () => MatchSnapshot;
  getPose: () => Pose;
  getSpeed: () => number;
  loadPathJson: (json: PedroJsonFile) => void;
  loadPathFromText: (text: string) => void;
  getPathChain: () => PathChain | null;
  clearPath: () => void;
  getFollower: () => AutoSequenceRunner;
  startAuto: () => void;
  getBotDebug: () => BotDebugState[];
  getNpcPoses: () => Array<{ id: string; pose: Pose; linear: { x: number; y: number } }>;
  stepSimulation?: (steps: number) => void;
  ensureBotsEnabled?: () => void;
  startInfinitePractice?: () => void;
  startTimedAuto?: () => void;
  resetMatch?: () => void;
}): () => void {
  let scenarioTimer: number | null = null;

  const clearScenarioTimer = () => {
    if (scenarioTimer !== null) {
      window.clearTimeout(scenarioTimer);
      scenarioTimer = null;
    }
  };

  const api: FtcSimDevApi = {
    injectInput: (input) => hooks.setInjectInput(input),
    clearInput: () => hooks.setInjectInput(null),
    resetGamepad: () => hooks.resetGamepad?.(),
    getTelemetry: () => hooks.getTelemetry(),
    snapshot: () => {
      const match = hooks.getMatchSnapshot();
      return {
        phase: match.phase,
        timeElapsed: match.timeElapsed,
        phaseTime: match.timeRemainingInPhase,
        allowsDrive: match.allowsDrive,
        controlSource: match.controlSource,
        paused: match.paused,
        running: match.running,
        pose: hooks.getPose(),
        speed: hooks.getSpeed(),
      };
    },
    loadPathJson: (json) => hooks.loadPathJson(json),
    loadPathFile: (text) => hooks.loadPathFromText(text),
    getPathSnapshot: () => {
      const chain = hooks.getPathChain();
      if (!chain) return null;
      const points = pathChainToPoints(chain, 80);
      const first = points[0];
      const last = points[points.length - 1];
      return {
        pointCount: points.length,
        totalLength: chain.totalLength(),
        segmentCount: chain.paths.length,
        firstPoint: first ? { x: first.x, y: first.y } : null,
        lastPoint: last ? { x: last.x, y: last.y } : null,
      };
    },
    clearPath: () => hooks.clearPath(),
    getFollowerSnapshot: () => {
      const follower = hooks.getFollower();
      follower.setPose(hooks.getPose());
      if (!follower.isBusy() && !hooks.getPathChain()) return null;
      return {
        busy: follower.isBusy(),
        errors: follower.getErrors(),
        progress: follower.getProgress(),
        targetPose: follower.getTargetPose(),
      };
    },
    startAuto: () => hooks.startAuto(),
    getBotDebug: () => hooks.getBotDebug(),
    getNpcPoses: () => hooks.getNpcPoses(),
    runBotSmokeTest: async (opts: BotSmokeTestOptions = {}) => {
      const durationSec = opts.durationSec ?? 30;
      const mode = opts.mode ?? 'inf';

      hooks.resetMatch?.();
      hooks.ensureBotsEnabled?.();
      await waitForBotHarnessReady({
        getNpcPoses: () => hooks.getNpcPoses(),
        getMatchSnapshot: () => hooks.getMatchSnapshot(),
        stepSimulation: hooks.stepSimulation,
        startInfinitePractice: hooks.startInfinitePractice,
        startTimedAuto: hooks.startTimedAuto,
        mode,
      });

      const samples: Array<{
        debug: BotDebugState[];
        npcs: ReturnType<FtcSimDevApi['getNpcPoses']>;
      }> = [];
      const sampleEverySteps = Math.round(0.5 * SIM_HZ);
      const totalSteps = durationSec * SIM_HZ;
      const startPoses = Object.fromEntries(
        hooks.getNpcPoses().map((npc) => [npc.id, { ...npc.pose }]),
      );

      for (let stepped = 0; stepped < totalSteps; stepped += sampleEverySteps) {
        const batch = Math.min(sampleEverySteps, totalSteps - stepped);
        hooks.stepSimulation?.(batch);
        samples.push({
          debug: hooks.getBotDebug(),
          npcs: hooks.getNpcPoses(),
        });
      }

      const report = evaluateBotSmoke(samples, durationSec, opts, startPoses);
      console.info('[ftc-sim] bot smoke test', report);
      return report;
    },
    runScenario: async (name) => {
      const scenario = SCENARIOS[name];
      if (!scenario) throw new Error(`Unknown scenario: ${name}`);

      clearScenarioTimer();
      hooks.resetRobot?.();
      hooks.setInjectInput(scenario.on);

      const startCount = hooks.getTelemetry().length;

      await new Promise<void>((resolve) => {
        scenarioTimer = window.setTimeout(() => {
          hooks.setInjectInput(null);
          scenarioTimer = null;
          resolve();
        }, (scenario.framesOn / 120) * 1000);
      });

      await new Promise<void>((resolve) => {
        scenarioTimer = window.setTimeout(() => {
          scenarioTimer = null;
          resolve();
        }, (scenario.framesOff / 120) * 1000);
      });

      const frames = hooks.getTelemetry().slice(startCount);
      if (name.startsWith('goal')) {
        const report = summarizeGoalCollision(frames);
        console.info(`[ftc-sim] ${name}`, report);
        return report;
      }
    },
  };

  window.__ftcSim = api;

  return () => {
    clearScenarioTimer();
    hooks.setInjectInput(null);
    delete window.__ftcSim;
  };
};
