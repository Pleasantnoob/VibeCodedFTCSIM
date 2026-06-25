import type { FieldBodyDefinition, FieldDefinition, Vector2 } from './types.js';

export function loadFieldDefinition(source: string | FieldDefinition): FieldDefinition {
  if (typeof source === 'object') return source;
  throw new Error(`Field path loading must be done by caller: ${source}`);
}

export function validateFieldDefinition(field: FieldDefinition): void {
  if (field.fieldSizeInches <= 0) {
    throw new Error('fieldSizeInches must be positive');
  }
  if (!field.bodies.length) {
    throw new Error('Field must have at least one body');
  }
}

export function getZoneById(field: FieldDefinition, zoneId: string) {
  return field.zones.find((z) => z.id === zoneId);
}

export function getStartPose(field: FieldDefinition, key: string) {
  const pose = field.startPoses[key];
  if (!pose) throw new Error(`Unknown start pose: ${key}`);
  return pose;
}

/** Axis-aligned rectangle corners in Pedro inches (bottom-left origin). */
export function rectangleVertices(center: Vector2, width: number, height: number): Vector2[] {
  const halfW = width / 2;
  const halfH = height / 2;
  return [
    { x: center.x - halfW, y: center.y - halfH },
    { x: center.x + halfW, y: center.y - halfH },
    { x: center.x + halfW, y: center.y + halfH },
    { x: center.x - halfW, y: center.y + halfH },
  ];
}

/**
 * Bevel the sharp gate-mouth lip on goal barriers so robot OBB corners slide along
 * an edge instead of wedging on a re-entrant vertex. Idempotent — skips if already chamfered.
 */
export function chamferGoalGateCorner(vertices: Vector2[], goalId: string): Vector2[] {
  if (goalId === 'blue_goal') {
    const sharpIdx = vertices.findIndex((v) => v.x === 6 && v.y === 70);
    if (sharpIdx >= 0) {
      const out = vertices.map((v) => ({ x: v.x, y: v.y }));
      out.splice(sharpIdx, 1, { x: 6, y: 72 });
      return out;
    }
    return vertices;
  }
  if (goalId === 'red_goal') {
    const sharpIdx = vertices.findIndex((v) => v.x === 138 && v.y === 70);
    if (sharpIdx >= 0) {
      const out = vertices.map((v) => ({ x: v.x, y: v.y }));
      out.splice(sharpIdx, 1, { x: 138, y: 72 });
      return out;
    }
    return vertices;
  }
  return vertices;
}

/** Polygon outline for any static body (Pedro inches). */
export function getBodyOutline(body: FieldBodyDefinition): Vector2[] {
  if (body.shape === 'polygon' && body.vertices?.length) {
    const verts = body.vertices.map((v) => ({ x: v.x, y: v.y }));
    if (body.id === 'blue_goal' || body.id === 'red_goal') {
      return chamferGoalGateCorner(verts, body.id);
    }
    return verts;
  }
  if (body.shape === 'rectangle' && body.center && body.width != null && body.height != null) {
    return rectangleVertices(body.center, body.width, body.height);
  }
  if (body.shape === 'circle' && body.center && body.radius != null) {
    const segments = 24;
    const out: Vector2[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      out.push({
        x: body.center.x + Math.cos(a) * body.radius,
        y: body.center.y + Math.sin(a) * body.radius,
      });
    }
    return out;
  }
  return [];
}

/** Collision barriers drawn on the field canvas (goals only). */
export function getBarrierBodies(field: FieldDefinition): FieldBodyDefinition[] {
  const ids = new Set(['red_goal', 'blue_goal']);
  return field.bodies.filter((b) => ids.has(b.id));
}

/** Launch / shooting zones shown on the field canvas. */
export function getLaunchZones(field: FieldDefinition) {
  return field.zones.filter((z) => z.type === 'launch_zone');
}

/** Scoring / debug zones (basin, ramp, gate, etc.) — excludes launch zones. */
export function getDebugZones(field: FieldDefinition) {
  return field.zones.filter((z) => z.type !== 'launch_zone');
}

export function getZonesByType(field: FieldDefinition, type: string) {
  return field.zones.filter((z) => z.type === type);
}

export function mirrorX(x: number, fieldSize = 144): number {
  return fieldSize - x;
}

/** Ray-casting point-in-polygon test (Pedro inches). */
export function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
