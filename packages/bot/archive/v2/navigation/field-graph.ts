import type { Vector2 } from '@ftc-sim/field';
import { FIELD_SIZE_INCHES, mirrorX } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';

export interface FieldNode {
  id: string;
  position: Vector2;
  alliance?: Alliance;
}

export interface FieldEdge {
  from: string;
  to: string;
  weight: number;
}

const FIELD_CENTER_X = FIELD_SIZE_INCHES / 2;

/** Mirror a blue-authored point across field center for red alliance. */
export function mirrorPointForAlliance(point: Vector2, alliance: Alliance): Vector2 {
  if (alliance === 'blue') return { ...point };
  return { x: mirrorX(point.x, FIELD_SIZE_INCHES), y: point.y };
}

function node(id: string, x: number, y: number, alliance?: Alliance): FieldNode {
  return { id, position: { x, y }, alliance };
}

/** Static DECODE navigation graph (Pedro inches). Blue-centric node ids. */
export function buildDecodeFieldGraph(): { nodes: Map<string, FieldNode>; edges: FieldEdge[] } {
  const nodes = new Map<string, FieldNode>();

  const add = (id: string, x: number, y: number, alliance?: Alliance) => {
    nodes.set(id, node(id, x, y, alliance));
  };

  add('center', 72, 72);
  add('blue_far_spawn', 56, 12);
  add('blue_near_spawn', 22, 118);
  add('red_far_spawn', 88, 12);
  add('red_near_spawn', 122, 118);

  add('blue_spike_y36', 24, 36);
  add('blue_spike_y60', 24, 60);
  add('blue_spike_y84', 24, 84);
  add('red_spike_y36', 120, 36);
  add('red_spike_y60', 120, 60);
  add('red_spike_y84', 120, 84);

  add('blue_spike_approach_y36', 30, 30);
  add('blue_spike_approach_y60', 30, 54);
  add('blue_spike_approach_y84', 30, 78);
  add('red_spike_approach_y36', 114, 30);
  add('red_spike_approach_y60', 114, 54);
  add('red_spike_approach_y84', 114, 78);

  add('blue_station', 6, 10);
  add('red_station', 138, 10);

  add('blue_far_launch', 56, 14);
  add('blue_near_launch', 40, 110);
  add('red_far_launch', 88, 14);
  add('red_near_launch', 104, 110);

  add('blue_shoot_far', 68, 10);
  add('blue_shoot_near', 40, 115);
  add('red_shoot_far', 76, 10);
  add('red_shoot_near', 104, 115);

  add('blue_gate', 9, 68);
  add('red_gate', 135, 68);

  add('blue_base', 105, 33);
  add('red_base', 33, 33);

  add('mid_south', 72, 24);
  add('mid_north', 72, 108);
  add('west_mid', 36, 72);
  add('east_mid', 108, 72);

  const edges: FieldEdge[] = [];
  const link = (a: string, b: string, weight?: number) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const dist = Math.hypot(na.position.x - nb.position.x, na.position.y - nb.position.y);
    edges.push({ from: a, to: b, weight: weight ?? dist });
    edges.push({ from: b, to: a, weight: weight ?? dist });
  };

  link('center', 'mid_south', 40);
  link('center', 'mid_north', 40);
  link('center', 'west_mid', 40);
  link('center', 'east_mid', 40);

  link('mid_south', 'blue_far_launch');
  link('mid_south', 'red_far_launch');

  link('mid_north', 'blue_near_launch');
  link('mid_north', 'red_near_launch');

  link('west_mid', 'blue_spike_y36');
  link('west_mid', 'blue_spike_y60');
  link('west_mid', 'blue_spike_y84');
  link('blue_spike_y36', 'blue_spike_approach_y36');
  link('blue_spike_y60', 'blue_spike_approach_y60');
  link('blue_spike_y84', 'blue_spike_approach_y84');

  link('east_mid', 'red_spike_y36');
  link('east_mid', 'red_spike_y60');
  link('east_mid', 'red_spike_y84');
  link('red_spike_y36', 'red_spike_approach_y36');
  link('red_spike_y60', 'red_spike_approach_y60');
  link('red_spike_y84', 'red_spike_approach_y84');

  link('blue_far_spawn', 'blue_station', 20);
  link('red_far_spawn', 'red_station', 20);
  link('blue_far_launch', 'blue_shoot_far', 8);
  link('red_far_launch', 'red_shoot_far', 8);
  link('blue_near_launch', 'blue_shoot_near', 8);
  link('red_near_launch', 'red_shoot_near', 8);

  link('blue_spike_y84', 'blue_gate', 50);
  link('red_spike_y84', 'red_gate', 50);
  link('blue_gate', 'blue_base', 55);
  link('red_gate', 'red_base', 55);
  link('west_mid', 'blue_base', 40);
  link('east_mid', 'red_base', 40);

  link('blue_shoot_far', 'blue_far_launch', 6);
  link('red_shoot_far', 'red_far_launch', 6);
  link('blue_shoot_near', 'blue_near_launch', 6);
  link('red_shoot_near', 'red_near_launch', 6);
  link('west_mid', 'blue_shoot_far', 45);
  link('east_mid', 'red_shoot_far', 45);
  link('west_mid', 'blue_shoot_near', 55);
  link('east_mid', 'red_shoot_near', 55);

  // Alliance spine lanes — stay on own half, avoid routing through x=72.
  link('blue_near_spawn', 'blue_spike_approach_y84', 22);
  link('blue_spike_approach_y84', 'blue_spike_approach_y60', 26);
  link('blue_spike_approach_y60', 'blue_spike_approach_y36', 26);
  link('blue_spike_approach_y36', 'blue_far_spawn', 32);
  link('blue_far_spawn', 'blue_far_launch', 6);
  link('blue_near_spawn', 'blue_near_launch', 14);
  link('blue_near_launch', 'blue_shoot_near', 6);
  link('blue_shoot_near', 'blue_spike_approach_y84', 32);
  link('blue_shoot_far', 'blue_base', 42);
  link('blue_base', 'blue_shoot_far', 42);

  link('red_near_spawn', 'red_spike_approach_y84', 22);
  link('red_spike_approach_y84', 'red_spike_approach_y60', 26);
  link('red_spike_approach_y60', 'red_spike_approach_y36', 26);
  link('red_spike_approach_y36', 'red_far_spawn', 32);
  link('red_far_spawn', 'red_far_launch', 6);
  link('red_near_spawn', 'red_near_launch', 14);
  link('red_near_launch', 'red_shoot_near', 6);
  link('red_shoot_near', 'red_spike_approach_y84', 32);
  link('red_shoot_far', 'red_base', 42);
  link('red_base', 'red_shoot_far', 42);

  return { nodes, edges };
}

export function resolveNodeForAlliance(nodeId: string, alliance: Alliance): string {
  if (alliance === 'blue') return nodeId;
  if (nodeId.startsWith('blue_')) return nodeId.replace(/^blue_/, 'red_');
  if (nodeId.startsWith('red_')) return nodeId.replace(/^red_/, 'blue_');
  return nodeId;
}

export function nodePosition(
  nodes: Map<string, FieldNode>,
  nodeId: string,
  alliance: Alliance,
): Vector2 | null {
  const resolved = resolveNodeForAlliance(nodeId, alliance);
  const n = nodes.get(resolved);
  return n ? { ...n.position } : null;
}

/** Neutral hub nodes both alliances may use (heavily penalized in path costs). */
export function isNeutralHubNodeId(nodeId: string): boolean {
  return nodeId === 'center' || nodeId.startsWith('mid_');
}

/** Alliance-specific graph nodes (blue_* / red_* prefixes). */
export function isAllianceNodeId(nodeId: string, alliance: Alliance): boolean {
  return alliance === 'blue' ? nodeId.startsWith('blue_') : nodeId.startsWith('red_');
}

export function isOpponentNodeId(nodeId: string, alliance: Alliance): boolean {
  if (isNeutralHubNodeId(nodeId)) return false;
  return alliance === 'blue' ? nodeId.startsWith('red_') : nodeId.startsWith('blue_');
}

export function nearestNodeId(
  nodes: Map<string, FieldNode>,
  point: Vector2,
  alliance: Alliance,
  filter?: (id: string) => boolean,
): string {
  let bestId = alliance === 'blue' ? 'west_mid' : 'east_mid';
  let bestDist = Infinity;
  for (const [id, n] of nodes) {
    if (filter && !filter(id)) continue;
    if (id === 'center') continue;
    if (isOpponentNodeId(id, alliance)) continue;
    if (n.alliance && n.alliance !== alliance) continue;
    const d = Math.hypot(point.x - n.position.x, point.y - n.position.y);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId;
}
