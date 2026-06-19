import type { FieldDefinition, Pose, Vector2 } from './types.js';
import { getBarrierBodies, getBodyOutline, getLaunchZones, pointInPolygon } from './field-loader.js';

export const FIELD_CENTER_X = 72;
const WALL_CONTACT_EPS = 0.5;

export interface RobotFootprint {
  width: number;
  length: number;
}

export interface AutoStartValidation {
  ok: boolean;
  errors: string[];
}

function robotCorners(pose: Pose, footprint: RobotFootprint): Vector2[] {
  const halfForward = footprint.length / 2;
  const halfLeft = footprint.width / 2;
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  const local: Vector2[] = [
    { x: halfForward, y: halfLeft },
    { x: halfForward, y: -halfLeft },
    { x: -halfForward, y: -halfLeft },
    { x: -halfForward, y: halfLeft },
  ];
  return local.map((point) => ({
    x: pose.x + point.x * cos - point.y * sin,
    y: pose.y + point.x * sin + point.y * cos,
  }));
}

export function isInAllianceHalf(pose: Pose, alliance: 'red' | 'blue'): boolean {
  if (alliance === 'blue') return pose.x < FIELD_CENTER_X;
  return pose.x > FIELD_CENTER_X;
}

export function isInLaunchZone(
  pose: Pose,
  field: FieldDefinition,
  footprint?: RobotFootprint,
  alliance?: 'red' | 'blue',
): boolean {
  const zones = getLaunchZones(field);
  const points: Vector2[] = footprint
    ? robotCorners(pose, footprint)
    : [{ x: pose.x, y: pose.y }];
  if (zones.some((zone) => points.some((p) => pointInPolygon(p, zone.polygon)))) {
    return true;
  }
  // G304 wall starts: south perimeter contact on alliance side counts as launch area.
  if (footprint && alliance) {
    const touchesSouth = points.some((p) => p.y <= WALL_CONTACT_EPS);
    if (touchesSouth && isInAllianceHalf(pose, alliance)) return true;
  }
  return false;
}

function pointNearSegment(
  point: Vector2,
  a: Vector2,
  b: Vector2,
  epsilon: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y) <= epsilon;
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY) <= epsilon;
}

function pointNearPolygonEdge(point: Vector2, polygon: Vector2[], epsilon: number): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (pointNearSegment(point, a, b, epsilon)) return true;
  }
  return false;
}

function robotEdges(corners: Vector2[]): [Vector2, Vector2][] {
  return corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]!]);
}

/** True when this robot edge segment contacts the given field wall line. */
function segmentTouchesFieldWall(
  a: Vector2,
  b: Vector2,
  wall: 'south' | 'west' | 'east' | 'north',
  fieldSize: number,
  epsilon: number,
): boolean {
  switch (wall) {
    case 'south':
      return Math.min(a.y, b.y) <= epsilon;
    case 'north':
      return Math.max(a.y, b.y) >= fieldSize - epsilon;
    case 'west':
      return Math.min(a.x, b.x) <= epsilon;
    case 'east':
      return Math.max(a.x, b.x) >= fieldSize - epsilon;
  }
}

function segmentTouchesPolygonEdge(
  a: Vector2,
  b: Vector2,
  polygon: Vector2[],
  epsilon: number,
): boolean {
  const samples = [
    a,
    b,
    { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  ];
  return samples.some((point) => pointNearPolygonEdge(point, polygon, epsilon));
}

/**
 * Start contact rule: at least one robot edge must touch the field perimeter
 * or goal outline. Only a single side needs contact (not a corner on two walls).
 */
export function touchesStartPerimeter(
  pose: Pose,
  footprint: RobotFootprint,
  field: FieldDefinition,
): boolean {
  const corners = robotCorners(pose, footprint);
  const fieldSize = field.fieldSizeInches;
  const walls = ['south', 'west', 'east', 'north'] as const;

  for (const [a, b] of robotEdges(corners)) {
    for (const wall of walls) {
      if (segmentTouchesFieldWall(a, b, wall, fieldSize, WALL_CONTACT_EPS)) {
        return true;
      }
    }
    for (const goal of getBarrierBodies(field)) {
      const outline = getBodyOutline(goal);
      if (segmentTouchesPolygonEdge(a, b, outline, WALL_CONTACT_EPS)) {
        return true;
      }
    }
  }

  return false;
}

/** @deprecated Use touchesStartPerimeter */
export function touchesWallOrGoal(
  pose: Pose,
  footprint: RobotFootprint,
  field: FieldDefinition,
): boolean {
  return touchesStartPerimeter(pose, footprint, field);
}

export function validateAutoStartPose(
  pose: Pose,
  alliance: 'red' | 'blue',
  field: FieldDefinition,
  footprint: RobotFootprint,
): AutoStartValidation {
  const errors: string[] = [];

  if (!isInAllianceHalf(pose, alliance)) {
    errors.push(`${alliance} robot must start on the ${alliance} side of the field (x=${FIELD_CENTER_X})`);
  }
  if (!isInLaunchZone(pose, field, footprint, alliance)) {
    errors.push('Robot must start inside near or far launch zone');
  }
  if (!touchesStartPerimeter(pose, footprint, field)) {
    errors.push('At least one robot edge must contact the field perimeter or goal');
  }

  return { ok: errors.length === 0, errors };
}

export function checkAutoBoundaryViolation(
  pose: Pose,
  alliance: 'red' | 'blue',
): boolean {
  if (alliance === 'blue') return pose.x >= FIELD_CENTER_X;
  return pose.x <= FIELD_CENTER_X;
}
