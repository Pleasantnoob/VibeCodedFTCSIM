import { normalizeAngle } from '@ftc-sim/field';
import {
  artifactTooCloseToOpponentGate,
  distToOpponentGate,
  OPPONENT_GATE_ARTIFACT_EXCLUDE_IN,
  OPPONENT_GATE_ARTIFACT_PENALTY_IN,
} from './coordination.js';
import type { Alliance } from '@ftc-sim/game-decode';
import type { Difficulty } from './types.js';
import type { BotArtifactSnapshot, BotRobotSnapshot } from './types.js';
import {
  clusterWeightFor,
  usesVelocityDeconflict,
} from './personality/difficulty.js';

const FIELD_MID_X = 72;
const CLUSTER_RADIUS = 14;
const DIST_WEIGHT = 0.55;
const SCATTER_BONUS = 6;
const RIVAL_CLUSTER_PENALTY = 45;
const RIVAL_MIN_SPEED = 6;
const RIVAL_MAX_DIST = 58;
const RIVAL_AIM_RAD = 0.55;
const GATE_PROXIMITY_PENALTY = 80;

const NON_COLLECTIBLE_PHASES = new Set([
  'held',
  'inFlight',
  'onRamp',
  'humanPlayerReserve',
]);

export interface ArtifactScanSummary {
  total: number;
  collectible: number;
  held: number;
  blocked: number;
  wrongPhase: number;
  wrongAlliance: number;
  humanPlayer: number;
}

function onAllianceHalf(pose: { x: number; y: number }, alliance: Alliance): boolean {
  return alliance === 'blue' ? pose.x <= FIELD_MID_X + 14 : pose.x >= FIELD_MID_X - 14;
}

function storedArtifactIds(robots: readonly BotRobotSnapshot[]): Set<string> {
  const ids = new Set<string>();
  for (const robot of robots) {
    for (const held of robot.stored) {
      ids.add(held.id);
    }
  }
  return ids;
}

function rejectReasonWithoutGate(
  artifact: BotArtifactSnapshot,
  alliance: Alliance,
): 'ok' | 'phase' | 'human' | 'alliance' {
  if (NON_COLLECTIBLE_PHASES.has(artifact.phase)) return 'phase';
  if (artifact.phase !== 'onField' && artifact.phase !== 'overflow' && artifact.phase !== 'humanPlayerStation') {
    return 'phase';
  }

  const src = artifact.source ?? '';
  if (src.includes('_human_player_reserve')) {
    if (artifact.phase === 'onField' || artifact.phase === 'overflow') return 'ok';
    return 'human';
  }

  if (artifact.phase === 'humanPlayerStation') {
    return src.startsWith(`${alliance}_`) && src.includes('_human_player_station') ? 'ok' : 'human';
  }

  if (src.includes('_human_player_station')) {
    if (artifact.phase === 'onField' || artifact.phase === 'overflow') return 'ok';
    return 'human';
  }

  if (src.startsWith(`${alliance}_`)) return 'ok';
  if (src.includes('_spike_')) {
    return src.startsWith(`${alliance}_`) ? 'ok' : 'alliance';
  }

  if (!src) {
    return onAllianceHalf(artifact.pose, alliance) ? 'ok' : 'alliance';
  }

  return onAllianceHalf(artifact.pose, alliance) ? 'ok' : 'alliance';
}

function rejectReason(
  artifact: BotArtifactSnapshot,
  alliance: Alliance,
): 'ok' | 'phase' | 'human' | 'alliance' | 'gate' {
  const base = rejectReasonWithoutGate(artifact, alliance);
  if (base !== 'ok') return base;
  if (artifactTooCloseToOpponentGate(artifact.pose, alliance)) return 'gate';
  return 'ok';
}

/** Collectible artifact for this alliance (spike rows, overflow, alliance-side balls). */
export function isCollectibleArtifact(
  artifact: BotArtifactSnapshot,
  alliance: Alliance,
): boolean {
  return rejectReason(artifact, alliance) === 'ok';
}

export function scanCollectibleArtifacts(
  robot: BotRobotSnapshot,
  artifacts: BotArtifactSnapshot[],
  robots: readonly BotRobotSnapshot[] = [],
  excludeIds: ReadonlySet<string> = new Set(),
): ArtifactScanSummary {
  const heldIds = storedArtifactIds(robots);
  const summary: ArtifactScanSummary = {
    total: artifacts.length,
    collectible: 0,
    held: 0,
    blocked: 0,
    wrongPhase: 0,
    wrongAlliance: 0,
    humanPlayer: 0,
  };

  for (const artifact of artifacts) {
    if (heldIds.has(artifact.id)) {
      summary.held++;
      continue;
    }
    if (excludeIds.has(artifact.id)) {
      summary.blocked++;
      continue;
    }
    const reason = rejectReason(artifact, robot.alliance);
    if (reason === 'ok') {
      summary.collectible++;
    } else if (reason === 'phase') {
      summary.wrongPhase++;
    } else if (reason === 'human') {
      summary.humanPlayer++;
    } else if (reason === 'gate') {
      summary.wrongAlliance++;
    } else {
      summary.wrongAlliance++;
    }
  }

  return summary;
}

function clusterSize(
  seed: BotArtifactSnapshot,
  pool: BotArtifactSnapshot[],
): number {
  let count = 0;
  for (const other of pool) {
    const dist = Math.hypot(
      other.pose.x - seed.pose.x,
      other.pose.y - seed.pose.y,
    );
    if (dist <= CLUSTER_RADIUS) count++;
  }
  return count;
}

function clusterCentroid(
  seed: BotArtifactSnapshot,
  pool: BotArtifactSnapshot[],
): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const other of pool) {
    const dist = Math.hypot(other.pose.x - seed.pose.x, other.pose.y - seed.pose.y);
    if (dist > CLUSTER_RADIUS) continue;
    sx += other.pose.x;
    sy += other.pose.y;
    n++;
  }
  if (n === 0) return { x: seed.pose.x, y: seed.pose.y };
  return { x: sx / n, y: sy / n };
}

function rivalMovingToward(
  selfId: string,
  point: { x: number; y: number },
  robots: readonly BotRobotSnapshot[],
): boolean {
  for (const other of robots) {
    if (other.id === selfId) continue;
    const speed = Math.hypot(other.linear.x, other.linear.y);
    if (speed < RIVAL_MIN_SPEED) continue;
    const dist = Math.hypot(point.x - other.pose.x, point.y - other.pose.y);
    if (dist > RIVAL_MAX_DIST) continue;
    const toPoint = Math.atan2(point.y - other.pose.y, point.x - other.pose.x);
    const velDir = Math.atan2(other.linear.y, other.linear.x);
    if (Math.abs(normalizeAngle(toPoint - velDir)) <= RIVAL_AIM_RAD) {
      return true;
    }
  }
  return false;
}

export interface CollectTargetPick {
  artifact: BotArtifactSnapshot;
  dist: number;
  cluster: number;
  score: number;
  mode: 'cluster' | 'cleanup' | 'nearest' | 'deconflict';
}

export interface CollectScanResult {
  pick: CollectTargetPick | null;
  polled: Array<{
    id: string;
    x: number;
    y: number;
    score: number;
    chosen: boolean;
  }>;
}

/** Pick artifact balancing nearby clusters vs scattered cleanup. */
export function pickCollectTarget(
  robot: BotRobotSnapshot,
  artifacts: BotArtifactSnapshot[],
  robots: readonly BotRobotSnapshot[] = [],
  excludeIds: ReadonlySet<string> = new Set(),
  difficulty: Difficulty = 'normal',
): CollectScanResult {
  const heldIds = storedArtifactIds(robots);
  const pool: BotArtifactSnapshot[] = [];

  for (const artifact of artifacts) {
    if (excludeIds.has(artifact.id) || heldIds.has(artifact.id)) continue;
    if (!isCollectibleArtifact(artifact, robot.alliance)) continue;
    pool.push(artifact);
  }

  if (pool.length === 0) {
    return { pick: null, polled: [] };
  }

  const groupBonus = clusterWeightFor(difficulty);
  let best: CollectTargetPick | null = null;
  const polled: CollectScanResult['polled'] = [];

  for (const artifact of pool) {
    const dist = Math.hypot(
      artifact.pose.x - robot.pose.x,
      artifact.pose.y - robot.pose.y,
    );
    const cluster = clusterSize(artifact, pool);
    const groupScore = (cluster - 1) * groupBonus;
    const scatterScore = cluster === 1 ? SCATTER_BONUS : 0;
    let score = groupScore + scatterScore - dist * DIST_WEIGHT;

    let mode: CollectTargetPick['mode'] =
      cluster >= 3 ? 'cluster' : cluster === 1 ? 'cleanup' : 'nearest';

    if (usesVelocityDeconflict(difficulty)) {
      const centroid = clusterCentroid(artifact, pool);
      if (rivalMovingToward(robot.id, centroid, robots)) {
        score -= RIVAL_CLUSTER_PENALTY;
        mode = 'deconflict';
      }
    }

    const gateDist = distToOpponentGate(artifact.pose, robot.alliance);
    if (gateDist < OPPONENT_GATE_ARTIFACT_PENALTY_IN) {
      const t = 1 - gateDist / OPPONENT_GATE_ARTIFACT_PENALTY_IN;
      score -= GATE_PROXIMITY_PENALTY * t;
      if (gateDist < OPPONENT_GATE_ARTIFACT_EXCLUDE_IN + 4) {
        mode = 'deconflict';
      }
    }

    polled.push({
      id: artifact.id,
      x: artifact.pose.x,
      y: artifact.pose.y,
      score,
      chosen: false,
    });

    if (!best || score > best.score) {
      best = { artifact, dist, cluster, score, mode };
    }
  }

  if (best) {
    const chosen = polled.find((entry) => entry.id === best!.artifact.id);
    if (chosen) chosen.chosen = true;
  }

  return { pick: best, polled };
}

/** @deprecated use pickCollectTarget */
export function findClosestCollectibleArtifact(
  robot: BotRobotSnapshot,
  artifacts: BotArtifactSnapshot[],
  robots: readonly BotRobotSnapshot[] = [],
  excludeIds: ReadonlySet<string> = new Set(),
): { artifact: BotArtifactSnapshot; dist: number } | null {
  const { pick } = pickCollectTarget(robot, artifacts, robots, excludeIds);
  return pick ? { artifact: pick.artifact, dist: pick.dist } : null;
}

export function countCollectibleArtifacts(
  robot: BotRobotSnapshot,
  artifacts: BotArtifactSnapshot[],
  robots: readonly BotRobotSnapshot[] = [],
): number {
  return scanCollectibleArtifacts(robot, artifacts, robots).collectible;
}
