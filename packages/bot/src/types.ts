import type { FieldDefinition, Pose, Vector2 } from '@ftc-sim/field';
import type { Alliance, ArtifactColor, MatchState } from '@ftc-sim/game-decode';
import type { MatchPhase, MatchSnapshot } from '@ftc-sim/match';
import type { StoredArtifact } from '@ftc-sim/mechanisms';
import type { AutoSequence, PathChain } from '@ftc-sim/pedro';
import type { DriveFrame, HolonomicInput, KinematicLimits, RobotFootprint } from '@ftc-sim/robot';

export type Difficulty = 'easy' | 'normal' | 'hard';

export type BotRobotId = 'player' | 'blue-near' | 'red-far' | 'red-near';

/** Pedro path loaded for a bot's AUTO period (blue-authored; mirrored per alliance). */
export interface BotAutoPath {
  basePathChain: PathChain;
  baseAutoSequence: AutoSequence | null;
  label: string;
  /** Bumped on each load so the manager restarts the follower when the path changes. */
  loadId: number;
}

export interface BotSlotConfig {
  robotId: BotRobotId;
  enabled: boolean;
  difficulty: Difficulty;
  /** Follow a loaded Pedro path during the AUTO period. */
  runAuto: boolean;
  autoPath: BotAutoPath | null;
}

export interface BotRobotSnapshot {
  id: string;
  alliance: Alliance;
  pose: Pose;
  linear: Vector2;
  angular: number;
  stored: StoredArtifact[];
}

export interface BotArtifactSnapshot {
  id: string;
  color: ArtifactColor;
  phase: string;
  pose: Pose;
  source?: string;
}

export interface BotWorldSnapshot {
  tickIndex: number;
  match: MatchSnapshot;
  field: FieldDefinition;
  robots: BotRobotSnapshot[];
  artifacts: BotArtifactSnapshot[];
  gameState: MatchState | null;
  barriers: Vector2[][];
  footprint: RobotFootprint;
  limits: KinematicLimits;
  robotMass: number;
  maxAcceleration: number;
  maxAngularAcceleration: number;
  humanInputRobotIds: ReadonlySet<string>;
  botSlots: BotSlotConfig[];
}

export interface BotObservation {
  tick: number;
  self: BotRobotSnapshot;
  allies: BotRobotSnapshot[];
  opponents: BotRobotSnapshot[];
  artifacts: BotArtifactSnapshot[];
  match: {
    phase: MatchPhase;
    timeElapsed: number;
    timeRemainingInPhase: number;
    infiniteMode: boolean;
    allowsDrive: boolean;
    controlSource: MatchSnapshot['controlSource'];
    running: boolean;
    paused: boolean;
  };
  game: {
    motif: '21' | '22' | '23';
    rampOccupancy: { red: (ArtifactColor | null)[]; blue: (ArtifactColor | null)[] };
    gateOpen: { red: boolean; blue: boolean };
    scores: { blue: number; red: number };
  };
  barriers: Vector2[][];
  field: FieldDefinition;
  footprint: RobotFootprint;
  limits: KinematicLimits;
  maxAcceleration: number;
  maxAngularAcceleration: number;
}

export interface BotDriveSample {
  input: HolonomicInput;
  driveFrame?: DriveFrame;
  mechanism: {
    command: { intake?: number; shoot?: boolean; gate?: boolean };
    shootEdge: boolean;
    gateEdge: boolean;
    shootHeld: boolean;
  };
}

export type BotTaskKind =
  | 'idle'
  | 'collect'
  | 'score'
  | 'gate'
  | 'park'
  | 'defend'
  | 'auto_drive'
  | 'auto_hold';

export type BotReplanReason = 'task_change' | 'interval' | 'stuck' | 'goal_moved';

/** Bump when bot overlay / debug fields change so the web app can confirm build is loaded. */
export const BOT_AI_VERSION = 'collect' as const;

export type BotDebugLogCategory =
  | 'task'
  | 'plan'
  | 'motion'
  | 'avoid'
  | 'stuck'
  | 'drive'
  | 'state'
  | 'warn';

export interface BotNavTrace {
  pose: { x: number; y: number; heading: number };
  velocity: { x: number; y: number; speed: number };
  taskTarget: Vector2;
  rawTaskTarget: Vector2;
  motionGoal: Vector2 | null;
  pursuitTarget: Vector2 | null;
  waypointIndex: number;
  pathLength: number;
  distTask: number;
  distGoal: number;
  distPursuit: number;
  startNode: string;
  goalNode: string;
  nodePath: string[];
  pathSignature: string;
  driveSource: 'stuck' | 'auto' | 'motion' | 'rotate';
  driveRaw: { f: number; s: number; t: number };
  driveAvoid: { f: number; s: number; t: number };
  driveBarrier: { f: number; s: number; t: number };
  driveFinal: { f: number; s: number; t: number };
  flags: string[];
}

export interface BotDebugState {
  robotId: string;
  alliance: Alliance;
  aiVersion?: typeof BOT_AI_VERSION;
  driveFrame?: DriveFrame;
  task: BotTaskKind;
  target: Vector2 | null;
  artifactId?: string;
  storedCount: number;
  inLaunchZone: boolean;
  aligned: boolean;
  atGoal: boolean;
  stuckPhase: string;
  gatePhase?: string;
  pathLength: number;
  path: Vector2[];
  reactionMsRemaining: number;
  lastReplanReason?: BotReplanReason;
  replanCount?: number;
  nav?: BotNavTrace;
  /** Collect task: every artifact considered this tick (for debug overlay). */
  collectScan?: {
    chosenId: string | null;
    polled: Array<{
      id: string;
      x: number;
      y: number;
      score: number;
      chosen: boolean;
    }>;
  };
}

export interface BotMetrics {
  replanCount: number;
  centerDwellSec: number;
  lastReplanReason?: BotReplanReason;
}

export interface BotTaskGoal {
  kind: BotTaskKind;
  target: Vector2;
  targetHeading?: number;
  artifactId?: string;
  goalNodeHint?: string;
  utility: number;
}
