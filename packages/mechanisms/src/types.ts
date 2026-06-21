import type { Pose, Vector2 } from '@ftc-sim/field';
import type { Alliance, ArtifactColor } from '@ftc-sim/game-decode';
import type { MechanismLogEntry } from './mechanism-log.js';

export const DEFAULT_PLAYER_ROBOT_ID = 'player';

export type { MechanismLogEntry } from './mechanism-log.js';

export interface MechanismCommand {
  intake?: number;
  shoot?: boolean;
  gate?: boolean;
}

export interface StoredArtifact {
  id: string;
  color: ArtifactColor;
  slot: 0 | 1 | 2;
}

export type ArtifactSimPhase =
  | 'onField'
  | 'humanPlayerStation'
  | 'humanPlayerReserve'
  | 'held'
  | 'inFlight'
  | 'onRamp'
  | 'overflow';

export interface SimArtifactState {
  id: string;
  color: ArtifactColor;
  phase: ArtifactSimPhase;
  bodyId: string;
  pose: { x: number; y: number; heading: number };
  opacity: number;
  /** Staging source tag (e.g. blue_human_player, blue_spike_y36). */
  source?: string;
  rampSlot?: number;
  flightElapsed?: number;
  scored?: boolean;
}

export interface GateReleaseItem {
  artifactId: string;
  color: ArtifactColor;
  targetAlliance: Alliance;
  openedByAlliance: Alliance;
  slotIndex: number;
  releaseAt: number;
  velocity: { x: number; y: number };
  spawnPose: { x: number; y: number; heading: number };
  startPose: { x: number; y: number; heading: number };
}

export interface RampRollAnimation {
  artifactId: string;
  targetAlliance: Alliance;
  openedByAlliance: Alliance;
  slotIndex: number;
  start: Pose;
  end: Pose;
  startTime: number;
  duration: number;
  velocity: Vector2;
}

export interface RobotMechanismStateSnapshot {
  stored: StoredArtifact[];
  intakeActive: boolean;
}

export interface RobotMechanismTick {
  robotId: string;
  pose: Pose;
  linear: Vector2;
  alliance: Alliance;
  command?: MechanismCommand;
  shootEdge: boolean;
  gateEdge: boolean;
  shootHeld: boolean;
}

export interface MechanismSnapshot {
  /** Player-slot storage (solo backward compat). */
  stored: StoredArtifact[];
  byRobot: Record<string, RobotMechanismStateSnapshot>;
  artifacts: SimArtifactState[];
  gateReleaseQueue: GateReleaseItem[];
  intakeActive: boolean;
  lastShotEligible: boolean;
  rampOccupancy: { red: (ArtifactColor | null)[]; blue: (ArtifactColor | null)[] };
  debugLogs: MechanismLogEntry[];
}

export const MAX_STORAGE = 3;
export const INTAKE_ACTIVE_THRESHOLD = 0.45;
/** One shot every N seconds while shoot trigger is held. */
export const SHOOT_HOLD_INTERVAL_S = 0.2;
