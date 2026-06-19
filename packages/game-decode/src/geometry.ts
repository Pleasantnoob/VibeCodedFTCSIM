import type { Pose, Vector2 } from '@ftc-sim/field';
import type { FieldZoneDefinition } from '@ftc-sim/field';

export function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findZoneAtPoint(zones: FieldZoneDefinition[], point: Vector2): FieldZoneDefinition | null {
  for (const zone of zones) {
    if (zone.polygon.length >= 3 && pointInPolygon(point, zone.polygon)) return zone;
  }
  return null;
}

export function emptyScore() {
  return {
    leave: 0,
    classified: 0,
    overflow: 0,
    depot: 0,
    pattern: 0,
    patternMatches: 0,
    base: 0,
    allianceBonus: 0,
    foulPoints: 0,
    total: 0,
  };
}

export function sumScore(parts: ReturnType<typeof emptyScore>): number {
  return (
    parts.leave +
    parts.classified +
    parts.overflow +
    parts.depot +
    parts.pattern +
    parts.base +
    parts.allianceBonus +
    parts.foulPoints
  );
}

export function distance(p: Vector2, q: Vector2): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function robotOverLaunchLine(pose: Pose, launchLineY: number, tolerance = 2): boolean {
  return pose.y <= launchLineY + tolerance;
}

export function evaluateBaseReturn(
  robotFootprint: Vector2[],
  basePolygon: Vector2[],
): 'none' | 'partial' | 'full' {
  let insideCount = 0;
  for (const pt of robotFootprint) {
    if (pointInPolygon(pt, basePolygon)) insideCount++;
  }
  if (insideCount === robotFootprint.length) return 'full';
  if (insideCount > 0) return 'partial';
  return 'none';
}

export function robotAnyPartInZone(footprint: Vector2[], polygon: Vector2[]): boolean {
  return footprint.some((pt) => pointInPolygon(pt, polygon));
}

export function robotFootprintsOverlap(a: Vector2[], b: Vector2[]): boolean {
  for (const pt of a) {
    if (pointInPolygon(pt, b)) return true;
  }
  for (const pt of b) {
    if (pointInPolygon(pt, a)) return true;
  }
  return false;
}

function closestPointOnSegment(point: Vector2, a: Vector2, b: Vector2): Vector2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return a;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** True when robot footprints touch or overlap (edge contact counts). */
export function robotFootprintsContact(a: Vector2[], b: Vector2[], skinInches = 0.25): boolean {
  if (robotFootprintsOverlap(a, b)) return true;

  for (const polygon of [a, b]) {
    const other = polygon === a ? b : a;
    for (const point of polygon) {
      for (let i = 0; i < other.length; i++) {
        const segA = other[i]!;
        const segB = other[(i + 1) % other.length]!;
        const closest = closestPointOnSegment(point, segA, segB);
        if (distance(point, closest) <= skinInches) return true;
      }
    }
  }

  return false;
}
