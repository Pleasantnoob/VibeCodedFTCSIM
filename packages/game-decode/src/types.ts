import type { Pose, Vector2 } from '@ftc-sim/field';

export type ArtifactColor = 'purple' | 'green';
export type Alliance = 'red' | 'blue';
export type MatchPhase = 'setup' | 'init' | 'auto' | 'transition' | 'teleop' | 'post';

export type ObeliskMotifId = '21' | '22' | '23';

export interface DecodeRulesConfig {
  season: string;
  version: string;
  matchTiming: {
    autoSec: number;
    transitionSec: number;
    teleopSec: number;
    championshipTransitionSec?: number;
  };
  scoring: {
    leave: number;
    classified: number;
    overflow: number;
    depot: number;
    patternPerArtifact: number;
    basePartial: number;
    baseFull: number;
    allianceBothFullBase: number;
  };
  fouls: {
    minor: number;
    major: number;
    foulCooldownSec: number;
  };
  endgameSec: number;
  motifs: Record<ObeliskMotifId, ArtifactColor[]>;
  rampSlots: number;
  maxPreloadPerRobot: number;
  maxRobotStorage: number;
  artifactDiameterInches: number;
  artifactMassKg: number;
  staging: Record<string, unknown>;
  zoneRefs: Record<string, string>;
}

export interface ScoreBreakdown {
  leave: number;
  classified: number;
  overflow: number;
  depot: number;
  /** Pattern points (matches × patternPerArtifact). */
  pattern: number;
  /** Count of ramp slots matching the obelisk motif (for HUD). */
  patternMatches: number;
  base: number;
  allianceBonus: number;
  /** Opponent foul points credited to this alliance (added to total, never subtracted). */
  foulPoints: number;
  total: number;
}

export interface GameEvent {
  t: number;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface AllianceScoreState {
  autoScore: ScoreBreakdown;
  teleopScore: ScoreBreakdown;
  score: ScoreBreakdown;
}

export interface AllianceFoulLedger {
  pointsReceived: number;
  minorCommitted: number;
  majorCommitted: number;
}

export interface MatchRobotSnapshot {
  id: string;
  alliance: Alliance;
  footprint: Vector2[];
}

export interface MatchState {
  phase: MatchPhase;
  timeElapsed: number;
  timeRemainingInPhase: number;
  alliance: Alliance;
  obeliskMotif: ObeliskMotifId;
  /** Mirrors {@link byAlliance} for the robot's alliance (panel / legacy consumers). */
  score: ScoreBreakdown;
  autoScore: ScoreBreakdown;
  teleopScore: ScoreBreakdown;
  byAlliance: Record<Alliance, AllianceScoreState>;
  gateOpen: { red: boolean; blue: boolean };
  rampOccupancy: { red: (ArtifactColor | null)[]; blue: (ArtifactColor | null)[] };
  fouls: Record<Alliance, AllianceFoulLedger>;
  robotParking: Record<string, 'none' | 'partial' | 'full'>;
  parkingScored: boolean;
  /** Per-robot AUTO LEAVE (3 pts each) at end of AUTO. */
  robotLeave: Record<string, boolean>;
  leaveScored: boolean;
  events: GameEvent[];
}

export const ARTIFACT_RADIUS_IN = 2.5;
export const ARTIFACT_MASS_KG = 0.0748;
export const ARTIFACT_MASS_LB = 0.165;
