import type { Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import { buildDecodeFieldGraph, nodePosition } from '../navigation/field-graph.js';
import type { BotObservation, BotTaskGoal } from '../types.js';
import type { AllianceBlackboard } from './blackboard.js';

const GOAL_BASIN: Record<Alliance, Vector2> = {
  blue: { x: 10, y: 132 },
  red: { x: 134, y: 132 },
};

const graphCache = buildDecodeFieldGraph();

/** Spread bots across spike rows so they do not all chase the same artifact. */
const SPIKE_ROW_PRIORITY: Record<string, number[]> = {
  'blue-near': [84, 60, 36],
  'red-near': [84, 60, 36],
  'red-far': [36, 60, 84],
  player: [60, 36, 84],
};

function countRampFilled(obs: BotObservation, alliance: Alliance): number {
  return obs.game.rampOccupancy[alliance].filter((slot) => slot !== null).length;
}

function fieldArtifacts(obs: BotObservation, alliance: Alliance) {
  return obs.artifacts.filter((artifact) => {
    if (artifact.phase !== 'onField') return false;
    const source = artifact.source ?? '';
    if (source.includes('_spike_')) {
      return source.startsWith(`${alliance}_`);
    }
    return source.startsWith(`${alliance}_`);
  });
}

function spikeRowFromSource(source: string | undefined): number | null {
  if (!source) return null;
  const match = source.match(/_y(\d+)/);
  return match ? Number(match[1]) : null;
}

function nearestArtifact(
  obs: BotObservation,
  alliance: Alliance,
  board: AllianceBlackboard,
  from: Vector2,
  robotId: string,
): { id: string; position: Vector2; row: number | null; color: import('@ftc-sim/game-decode').ArtifactColor } | null {
  const priorities = SPIKE_ROW_PRIORITY[robotId] ?? [60, 36, 84];
  let best: {
    id: string;
    position: Vector2;
    row: number | null;
    color: import('@ftc-sim/game-decode').ArtifactColor;
    score: number;
  } | null = null;

  for (const artifact of fieldArtifacts(obs, alliance)) {
    if (board.isClaimed(artifact.id)) continue;
    const dist = Math.hypot(from.x - artifact.pose.x, from.y - artifact.pose.y);
    const row = spikeRowFromSource(artifact.source);
    const rowRank = row === null ? priorities.length : priorities.indexOf(row);
    const rowBonus = rowRank >= 0 ? (priorities.length - rowRank) * 18 : 0;
    const score = rowBonus - dist;
    if (!best || score > best.score) {
      best = {
        id: artifact.id,
        position: { x: artifact.pose.x, y: artifact.pose.y },
        row,
        color: artifact.color,
        score,
      };
    }
  }
  return best ? { id: best.id, position: best.position, row: best.row, color: best.color } : null;
}

export function nearestArtifactCandidate(
  obs: BotObservation,
  board: AllianceBlackboard,
  from: Vector2,
  robotId: string,
): ReturnType<typeof nearestArtifact> {
  return nearestArtifact(obs, obs.self.alliance, board, from, robotId);
}

export function shootHeading(obs: BotObservation, aimError: number): number {
  const basin = GOAL_BASIN[obs.self.alliance];
  const base = Math.atan2(basin.y - obs.self.pose.y, basin.x - obs.self.pose.x);
  return base + aimError;
}

function launchApproach(alliance: Alliance, nearSpawn: boolean): Vector2 {
  const nodeId = nearSpawn
    ? alliance === 'blue'
      ? 'blue_shoot_near'
      : 'red_shoot_near'
    : alliance === 'blue'
      ? 'blue_shoot_far'
      : 'red_shoot_far';
  return nodePosition(graphCache.nodes, nodeId, alliance) ?? GOAL_BASIN[alliance];
}

/** Near/far launch is fixed per robot slot — never flip from crossing y=72 mid-drive. */
function usesNearLaunch(robotId: string): boolean {
  return robotId === 'blue-near' || robotId === 'red-near';
}

export function launchApproachForRobot(robotId: string, alliance: Alliance): Vector2 {
  return launchApproach(alliance, usesNearLaunch(robotId));
}

export function launchNodeHintForRobot(robotId: string, alliance: Alliance): string {
  if (usesNearLaunch(robotId)) {
    return alliance === 'blue' ? 'blue_shoot_near' : 'red_shoot_near';
  }
  return alliance === 'blue' ? 'blue_shoot_far' : 'red_shoot_far';
}

function gateApproach(alliance: Alliance): Vector2 {
  const nodeId = alliance === 'blue' ? 'blue_gate' : 'red_gate';
  return nodePosition(graphCache.nodes, nodeId, alliance) ?? { x: 72, y: 68 };
}

function baseApproach(alliance: Alliance): Vector2 {
  return nodePosition(graphCache.nodes, alliance === 'blue' ? 'blue_base' : 'red_base', alliance) ?? {
    x: alliance === 'blue' ? 105 : 33,
    y: 33,
  };
}

export function shouldPark(obs: BotObservation): boolean {
  if (obs.match.phase !== 'teleop' || !obs.match.running || obs.match.paused) return false;
  if (obs.match.infiniteMode) {
    return obs.match.timeElapsed >= 100;
  }
  return obs.match.timeRemainingInPhase <= 25;
}

export function patrolPoint(robotId: string, alliance: Alliance): Vector2 {
  const priorities = SPIKE_ROW_PRIORITY[robotId] ?? [60];
  const row = priorities[0] ?? 60;
  const nodeId = `${alliance === 'blue' ? 'blue' : 'red'}_spike_approach_y${row}`;
  return (
    nodePosition(graphCache.nodes, nodeId, alliance) ??
    nodePosition(graphCache.nodes, alliance === 'blue' ? 'west_mid' : 'east_mid', alliance) ?? {
      x: alliance === 'blue' ? 36 : 108,
      y: 72,
    }
  );
}

function collectApproachNodeId(alliance: Alliance, row: number | null): string | undefined {
  if (row === null) return undefined;
  const prefix = alliance === 'blue' ? 'blue' : 'red';
  return `${prefix}_spike_approach_y${row}`;
}

/** Fixed standoff per spike row — does not move when the robot moves. */
export function collectTargetForArtifact(
  artifactPos: Vector2,
  alliance: Alliance,
  row: number | null,
): { target: Vector2; goalNodeHint?: string } {
  const nodeId = collectApproachNodeId(alliance, row);
  const approach = nodeId ? nodePosition(graphCache.nodes, nodeId, alliance) : null;
  if (approach) {
    return {
      target: { x: approach.x, y: approach.y },
      goalNodeHint: nodeId,
    };
  }
  const offsetX = alliance === 'blue' ? 11 : -11;
  return {
    target: { x: artifactPos.x + offsetX, y: artifactPos.y },
  };
}

export function selectTask(
  obs: BotObservation,
  board: AllianceBlackboard,
  aimErrorRad: number,
  robotId: string,
): BotTaskGoal {
  const { self } = obs;
  const alliance = self.alliance;
  const storageFull = self.stored.length >= 3;
  const hasCargo = self.stored.length > 0;
  const rampCount = countRampFilled(obs, alliance);

  if (obs.match.phase === 'auto' || obs.match.phase === 'transition') {
    return {
      kind: 'auto_hold',
      target: launchApproachForRobot(robotId, alliance),
      targetHeading: shootHeading(obs, aimErrorRad),
      goalNodeHint: launchNodeHintForRobot(robotId, alliance),
      utility: 1,
    };
  }

  if (!obs.match.allowsDrive || !obs.match.running || obs.match.paused || obs.match.phase === 'post') {
    return {
      kind: 'idle',
      target: { x: self.pose.x, y: self.pose.y },
      utility: 0,
    };
  }

  if (shouldPark(obs)) {
    return {
      kind: 'park',
      target: baseApproach(alliance),
      targetHeading: Math.PI / 2,
      goalNodeHint: alliance === 'blue' ? 'blue_base' : 'red_base',
      utility: 10,
    };
  }

  if (hasCargo || storageFull) {
    return {
      kind: 'score',
      target: launchApproachForRobot(robotId, alliance),
      targetHeading: shootHeading(obs, aimErrorRad),
      goalNodeHint: launchNodeHintForRobot(robotId, alliance),
      utility: 9 + self.stored.length,
    };
  }

  if (rampCount >= 6 && !obs.game.gateOpen[alliance]) {
    return {
      kind: 'gate',
      target: gateApproach(alliance),
      goalNodeHint: alliance === 'blue' ? 'blue_gate' : 'red_gate',
      utility: 6,
    };
  }

  const artifact = nearestArtifact(obs, alliance, board, self.pose, robotId);
  if (artifact) {
    const { target, goalNodeHint } = collectTargetForArtifact(
      artifact.position,
      alliance,
      artifact.row,
    );
    return {
      kind: 'collect',
      target,
      artifactId: artifact.id,
      goalNodeHint,
      targetHeading: Math.atan2(
        artifact.position.y - target.y,
        artifact.position.x - target.x,
      ),
      utility: 5,
    };
  }

  return {
    kind: 'idle',
    target: patrolPoint(robotId, alliance),
    goalNodeHint: `${alliance === 'blue' ? 'blue' : 'red'}_spike_approach_y${SPIKE_ROW_PRIORITY[robotId]?.[0] ?? 60}`,
    utility: 0.2,
  };
}

export function goalBasinForAlliance(alliance: Alliance): Vector2 {
  return GOAL_BASIN[alliance];
}
