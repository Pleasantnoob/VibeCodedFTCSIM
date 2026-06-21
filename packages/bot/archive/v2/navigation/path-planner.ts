import type { Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { FieldEdge, FieldNode } from './field-graph.js';
import { isOpponentNodeId, nearestNodeId } from './field-graph.js';

const START_NODE_HYSTERESIS_IN = 7;
const CENTER_PENALTY_NODES = new Set(['center', 'mid_south', 'mid_north']);
const OPPONENT_NODE_BLOCK = 1e6;

function heuristic(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function opponentGateNode(alliance: Alliance): string {
  return alliance === 'blue' ? 'red_gate' : 'blue_gate';
}

function edgeWeight(from: string, to: string, baseWeight: number, alliance: Alliance): number {
  if (isOpponentNodeId(from, alliance) || isOpponentNodeId(to, alliance)) {
    return OPPONENT_NODE_BLOCK;
  }
  let weight = baseWeight;
  if (CENTER_PENALTY_NODES.has(from) || CENTER_PENALTY_NODES.has(to)) {
    weight *= 12;
  }
  if (from === opponentGateNode(alliance) || to === opponentGateNode(alliance)) {
    weight *= 5;
  }
  return weight;
}

export function planPath(
  nodes: Map<string, FieldNode>,
  edges: FieldEdge[],
  startId: string,
  goalId: string,
  alliance: Alliance,
): string[] {
  if (startId === goalId) return [startId];

  const startNode = nodes.get(startId);
  const goalNode = nodes.get(goalId);
  if (!startNode || !goalNode) return [startId, goalId];

  const adjacency = new Map<string, Array<{ to: string; weight: number }>>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push({ to: edge.to, weight: edgeWeight(edge.from, edge.to, edge.weight, alliance) });
    adjacency.set(edge.from, list);
  }

  const gScore = new Map<string, number>([[startId, 0]]);
  const fScore = new Map<string, number>([
    [startId, heuristic(startNode.position, goalNode.position)],
  ]);
  const parent = new Map<string, string>();
  const open = new Set<string>([startId]);

  while (open.size > 0) {
    let currentId = '';
    let bestF = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        currentId = id;
      }
    }

    if (currentId === goalId) {
      const path: string[] = [goalId];
      let cursor = goalId;
      while (parent.has(cursor)) {
        cursor = parent.get(cursor)!;
        path.unshift(cursor);
      }
      return path;
    }

    open.delete(currentId);
    const currentG = gScore.get(currentId) ?? Infinity;

    for (const neighbor of adjacency.get(currentId) ?? []) {
      if (isOpponentNodeId(neighbor.to, alliance)) continue;
      const tentativeG = currentG + neighbor.weight;
      if (tentativeG >= (gScore.get(neighbor.to) ?? Infinity)) continue;
      parent.set(neighbor.to, currentId);
      gScore.set(neighbor.to, tentativeG);
      const neighborNode = nodes.get(neighbor.to);
      if (!neighborNode) continue;
      fScore.set(
        neighbor.to,
        tentativeG + heuristic(neighborNode.position, goalNode.position),
      );
      open.add(neighbor.to);
    }
  }

  return [startId, goalId];
}

export function pathToPoints(nodes: Map<string, FieldNode>, nodeIds: string[]): Vector2[] {
  return nodeIds
    .map((id) => nodes.get(id)?.position)
    .filter((p): p is Vector2 => p !== undefined);
}

function appendUniquePoint(path: Vector2[], point: Vector2, minDist = 2): void {
  const last = path[path.length - 1];
  if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= minDist) {
    path.push({ x: point.x, y: point.y });
  }
}

export interface PathPlanMeta {
  startNodeId: string;
  goalNodeId: string;
  nodePath: string[];
  from: Vector2;
  goal: Vector2;
  skipped: boolean;
  skipReason?: string;
  goalMoved: boolean;
}

export class PathPlanner {
  private readonly nodes: Map<string, FieldNode>;
  private readonly edges: FieldEdge[];
  private lastPlanAt = 0;
  private lastPath: Vector2[] = [];
  private lastGoal: Vector2 | null = null;
  private lastStartNodeId: string | null = null;
  private lastGoalNodeId: string | null = null;
  private lastNodePath: string[] = [];
  private lastPlanMeta: PathPlanMeta | null = null;

  constructor(nodes: Map<string, FieldNode>, edges: FieldEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
  }

  get path(): Vector2[] {
    return this.lastPath;
  }

  get nodePath(): string[] {
    return this.lastNodePath;
  }

  get planMeta(): PathPlanMeta | null {
    return this.lastPlanMeta;
  }

  private resolveStartNode(from: Vector2, alliance: Alliance, reset = false): string {
    if (reset) {
      this.lastStartNodeId = null;
    }
    const nearest = nearestNodeId(this.nodes, from, alliance);
    if (!this.lastStartNodeId) {
      this.lastStartNodeId = nearest;
      return nearest;
    }
    const current = this.nodes.get(this.lastStartNodeId);
    if (!current) {
      this.lastStartNodeId = nearest;
      return nearest;
    }
    const currentDist = Math.hypot(from.x - current.position.x, from.y - current.position.y);
    const nearestNode = this.nodes.get(nearest);
    if (!nearestNode || nearest === this.lastStartNodeId) {
      return this.lastStartNodeId;
    }
    const nearestDist = Math.hypot(from.x - nearestNode.position.x, from.y - nearestNode.position.y);
    if (nearestDist + START_NODE_HYSTERESIS_IN < currentDist) {
      this.lastStartNodeId = nearest;
    }
    return this.lastStartNodeId;
  }

  private resolveGoalNode(goal: Vector2, alliance: Alliance, hint?: string, reset = false): string {
    if (reset) {
      this.lastGoalNodeId = null;
    }
    if (hint && this.nodes.has(hint) && !isOpponentNodeId(hint, alliance)) {
      this.lastGoalNodeId = hint;
      return hint;
    }
    const nearest = nearestNodeId(this.nodes, goal, alliance);
    if (!this.lastGoalNodeId) {
      this.lastGoalNodeId = nearest;
      return nearest;
    }
    const current = this.nodes.get(this.lastGoalNodeId);
    const nearestNode = this.nodes.get(nearest);
    if (!current || !nearestNode) {
      this.lastGoalNodeId = nearest;
      return nearest;
    }
    const currentDist = Math.hypot(goal.x - current.position.x, goal.y - current.position.y);
    const nearestDist = Math.hypot(goal.x - nearestNode.position.x, goal.y - nearestNode.position.y);
    if (nearestDist + START_NODE_HYSTERESIS_IN < currentDist) {
      this.lastGoalNodeId = nearest;
    }
    return this.lastGoalNodeId;
  }

  replan(
    nowSec: number,
    from: Vector2,
    goal: Vector2,
    alliance: Alliance,
    options?: { goalNodeHint?: string; force?: boolean },
    minIntervalSec = 0.75,
  ): Vector2[] {
    const goalMoved =
      !this.lastGoal || Math.hypot(this.lastGoal.x - goal.x, this.lastGoal.y - goal.y) >= 3;
    if (
      !options?.force &&
      !goalMoved &&
      nowSec - this.lastPlanAt < minIntervalSec &&
      this.lastPath.length > 0
    ) {
      this.lastPlanMeta = {
        startNodeId: this.lastStartNodeId ?? '?',
        goalNodeId: this.lastGoalNodeId ?? '?',
        nodePath: [...this.lastNodePath],
        from: { ...from },
        goal: { ...goal },
        skipped: true,
        skipReason: 'interval',
        goalMoved: false,
      };
      return this.lastPath;
    }

    const forceReset = Boolean(options?.force);
    const startId = this.resolveStartNode(from, alliance, forceReset);
    const goalId = this.resolveGoalNode(goal, alliance, options?.goalNodeHint, forceReset);
    const nodePath = planPath(this.nodes, this.edges, startId, goalId, alliance);
    this.lastNodePath = nodePath;
    this.lastPlanMeta = {
      startNodeId: startId,
      goalNodeId: goalId,
      nodePath: [...nodePath],
      from: { ...from },
      goal: { ...goal },
      skipped: false,
      goalMoved,
    };
    const graphPoints = pathToPoints(this.nodes, nodePath);
    const goalNodePoint = this.nodes.get(goalId)?.position ?? goal;

    const fullPath: Vector2[] = [];
    appendUniquePoint(fullPath, from);
    for (const point of graphPoints) {
      appendUniquePoint(fullPath, point);
    }
    // Prefer the resolved graph node as terminal — avoids backtracking when hint coords match.
    if (Math.hypot(goalNodePoint.x - goal.x, goalNodePoint.y - goal.y) <= 8) {
      appendUniquePoint(fullPath, goalNodePoint);
    } else {
      appendUniquePoint(fullPath, goal);
    }

    if (fullPath.length < 2) {
      fullPath.length = 0;
      appendUniquePoint(fullPath, from);
      appendUniquePoint(fullPath, goal);
    }

    this.lastPath = fullPath;
    this.lastPlanAt = nowSec;
    this.lastGoal = { ...goal };
    return this.lastPath;
  }

  clear(): void {
    this.lastPath = [];
    this.lastGoal = null;
    this.lastPlanAt = 0;
    this.lastStartNodeId = null;
    this.lastGoalNodeId = null;
    this.lastNodePath = [];
    this.lastPlanMeta = null;
  }
}
