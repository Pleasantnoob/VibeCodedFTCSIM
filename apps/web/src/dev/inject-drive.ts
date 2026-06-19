import type { MatchSnapshot } from '@ftc-sim/match';
import type { PathChain, PedroJsonFile } from '@ftc-sim/pedro';
import { pathChainToPoints } from '@ftc-sim/pedro';
import type { AutoSequenceRunner } from '@ftc-sim/pedro';
import type { HolonomicInput, Pose } from '@ftc-sim/robot';

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
