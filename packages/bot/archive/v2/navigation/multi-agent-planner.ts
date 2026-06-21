import type { Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { FieldEdge, FieldNode } from './field-graph.js';
import { planPath } from './path-planner.js';

export type BotRole = 'scorer' | 'collector' | 'defender' | 'park';

export interface BotPlanRequest {
  robotId: string;
  role: BotRole;
  from: Vector2;
  goal: Vector2;
  alliance: Alliance;
  goalNodeHint?: string;
}

const ROLE_PRIORITY: Record<BotRole, number> = {
  scorer: 4,
  collector: 3,
  defender: 2,
  park: 1,
};

const CORRIDOR_RADIUS_IN = 14;

function edgeMidpoint(nodes: Map<string, FieldNode>, from: string, to: string): Vector2 | null {
  const a = nodes.get(from)?.position;
  const b = nodes.get(to)?.position;
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function penalizeEdge(
  edges: FieldEdge[],
  from: string,
  to: string,
  penalty: number,
): void {
  for (const edge of edges) {
    if (
      (edge.from === from && edge.to === to) ||
      (edge.from === to && edge.to === from)
    ) {
      edge.weight += penalty;
    }
  }
}

/**
 * Prioritized Planning: higher-priority bots plan first; later bots pay
 * corridor penalties where earlier paths occupy graph edges.
 */
export class MultiAgentPlanner {
  private readonly nodes: Map<string, FieldNode>;
  private readonly baseEdges: FieldEdge[];

  constructor(nodes: Map<string, FieldNode>, edges: FieldEdge[]) {
    this.nodes = nodes;
    this.baseEdges = edges.map((edge) => ({ ...edge }));
  }

  planAll(requests: BotPlanRequest[]): Map<string, string[]> {
    const sorted = [...requests].sort(
      (a, b) => ROLE_PRIORITY[b.role] - ROLE_PRIORITY[a.role],
    );
    const results = new Map<string, string[]>();
    const workingEdges = this.baseEdges.map((edge) => ({ ...edge }));

    for (const req of sorted) {
      const startId = nearestNode(this.nodes, req.from, req.alliance);
      const goalId = req.goalNodeHint && this.nodes.has(req.goalNodeHint)
        ? req.goalNodeHint
        : nearestNode(this.nodes, req.goal, req.alliance);

      const nodePath = planPath(this.nodes, workingEdges, startId, goalId, req.alliance);
      results.set(req.robotId, nodePath);

      for (let i = 0; i < nodePath.length - 1; i++) {
        penalizeEdge(workingEdges, nodePath[i]!, nodePath[i + 1]!, CORRIDOR_RADIUS_IN * 2);
        const mid = edgeMidpoint(this.nodes, nodePath[i]!, nodePath[i + 1]!);
        if (mid) {
          for (const [id, node] of this.nodes) {
            if (Math.hypot(node.position.x - mid.x, node.position.y - mid.y) < CORRIDOR_RADIUS_IN) {
              for (const edge of workingEdges) {
                if (edge.from === id || edge.to === id) {
                  edge.weight += CORRIDOR_RADIUS_IN;
                }
              }
            }
          }
        }
      }
    }

    return results;
  }
}

function nearestNode(
  nodes: Map<string, FieldNode>,
  point: Vector2,
  alliance: Alliance,
): string {
  let bestId = 'center';
  let bestDist = Infinity;
  for (const [id, node] of nodes) {
    if (node.alliance && node.alliance !== alliance) continue;
    const dist = Math.hypot(point.x - node.position.x, point.y - node.position.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestId;
}
