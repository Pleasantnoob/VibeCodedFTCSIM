import type { Alliance, ArtifactColor } from '@ftc-sim/game-decode';
import type { MechanismLogEntry } from './mechanism-log.js';

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
}

export interface MechanismSnapshot {
  stored: StoredArtifact[];
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
