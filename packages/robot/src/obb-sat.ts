import type { Pose, Vector2 } from '@ftc-sim/field';
import type { RobotFootprint } from './types.js';
import { robotCorners } from './kinematic.js';

export const CONTACT_SKIN = 0.08;
export const VERTEX_RADIUS = 0.75;
export const EDGE_MARGIN = 0.4;
const PIN_DIST = 0.25;

export function contactPinDistance(obb: ObbState, contact: PolygonContact): number {
  const corner = obb.corners[contact.cornerIndex];
  return Math.hypot(corner.x - contact.point.x, corner.y - contact.point.y);
}

export interface ObbState {
  pose: Pose;
  footprint: RobotFootprint;
  corners: Vector2[];
  locals: Vector2[];
  edgeMidpoints: Vector2[];
}

export type ContactType = 'vertex' | 'edge';

export interface PolygonContact {
  type: ContactType;
  point: Vector2;
  normal: Vector2;
  penetration: number;
  cornerIndex: number;
  barrierEdgeIndex: number;
  barrierVertexIndex?: number;
}

export function localCorners(footprint: RobotFootprint): Vector2[] {
  const hf = footprint.length / 2;
  const hl = footprint.width / 2;
  return [
    { x: hf, y: hl },
    { x: hf, y: -hl },
    { x: -hf, y: -hl },
    { x: -hf, y: hl },
  ];
}

export function buildObb(pose: Pose, footprint: RobotFootprint): ObbState {
  const locals = localCorners(footprint);
  const corners = robotCorners(pose, footprint);
  const edgeMidpoints: Vector2[] = [];
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    edgeMidpoints.push({
      x: (corners[i].x + corners[j].x) / 2,
      y: (corners[i].y + corners[j].y) / 2,
    });
  }
  return { pose, footprint, corners, locals, edgeMidpoints };
}

/** Corners, edge midpoints, and quarter-edge points for face contact detection. */
export function obbSurfaceSamples(obb: ObbState): Vector2[] {
  const samples: Vector2[] = [...obb.corners, ...obb.edgeMidpoints];
  for (let i = 0; i < obb.corners.length; i++) {
    const j = (i + 1) % obb.corners.length;
    const a = obb.corners[i];
    const b = obb.corners[j];
    for (const t of [0.25, 0.75]) {
      samples.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
    }
  }
  return samples;
}

export function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(point: Vector2, a: Vector2, b: Vector2): Vector2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return { ...a };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
  return { x: a.x + t * abx, y: a.y + t * aby };
}

/** Outward normal from barrier edge (points into open field). */
export function edgeOutwardNormal(a: Vector2, b: Vector2, polygon: Vector2[]): Vector2 {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const left = { x: -ey, y: ex };
  const right = { x: ey, y: -ex };
  const leftLen = Math.hypot(left.x, left.y) || 1;
  const rightLen = Math.hypot(right.x, right.y) || 1;
  const leftN = { x: left.x / leftLen, y: left.y / leftLen };
  const testLeft = { x: mx + leftN.x * 0.15, y: my + leftN.y * 0.15 };
  if (!pointInPolygon(testLeft, polygon)) return leftN;
  return { x: right.x / rightLen, y: right.y / rightLen };
}

function signedDistanceToEdge(point: Vector2, a: Vector2, normal: Vector2): number {
  return (point.x - a.x) * normal.x + (point.y - a.y) * normal.y;
}

function sampleSegmentPenetration(
  point: Vector2,
  a: Vector2,
  b: Vector2,
  normal: Vector2,
): number {
  const closest = closestPointOnSegment(point, a, b);
  const segDist = Math.hypot(point.x - closest.x, point.y - closest.y);
  if (segDist > EDGE_MARGIN + CONTACT_SKIN) return 0;

  const planeDist = signedDistanceToEdge(point, a, normal);
  if (planeDist >= CONTACT_SKIN) return 0;

  return CONTACT_SKIN - planeDist;
}

function deepestOutwardPush(point: Vector2, polygon: Vector2[]): Vector2 | null {
  let bestPen = 0;
  let bestNormal: Vector2 | null = null;

  for (let ei = 0; ei < polygon.length; ei++) {
    const a = polygon[ei];
    const b = polygon[(ei + 1) % polygon.length];
    const normal = edgeOutwardNormal(a, b, polygon);
    const pen = sampleSegmentPenetration(point, a, b, normal);
    if (pen > bestPen) {
      bestPen = pen;
      bestNormal = normal;
    }
  }

  if (!bestNormal || bestPen <= 1e-6) return null;
  return { x: bestNormal.x * bestPen, y: bestNormal.y * bestPen };
}

function pushPointOutOfPolygon(point: Vector2, polygon: Vector2[], margin = CONTACT_SKIN): Vector2 {
  if (!pointInPolygon(point, polygon)) {
    return deepestOutwardPush(point, polygon) ?? { x: 0, y: 0 };
  }

  let bestDistSq = Infinity;
  let bestClosest = point;
  let bestNormal: Vector2 | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const closest = closestPointOnSegment(point, a, b);
    const dx = point.x - closest.x;
    const dy = point.y - closest.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestClosest = closest;
      bestNormal = edgeOutwardNormal(a, b, polygon);
    }
  }

  if (bestNormal) {
    const planeDist =
      (point.x - bestClosest.x) * bestNormal.x + (point.y - bestClosest.y) * bestNormal.y;
    const pen = Math.max(margin, margin - planeDist);
    return { x: bestNormal.x * pen, y: bestNormal.y * pen };
  }

  const dx = bestClosest.x - point.x;
  const dy = bestClosest.y - point.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1e-6) {
    const scale = (dist + margin) / dist;
    return { x: dx * scale, y: dy * scale };
  }
  return { x: margin, y: 0 };
}

/** Deepest outward push for any OBB sample (corners + edge midpoints). */
export function deepestObbSeparationPush(obb: ObbState, polygon: Vector2[]): Vector2 | null {
  let bestPush: Vector2 | null = null;
  let bestLen = 0;
  const samples = obbSurfaceSamples(obb);

  for (const point of samples) {
    const push = pointInPolygon(point, polygon)
      ? pushPointOutOfPolygon(point, polygon)
      : (deepestOutwardPush(point, polygon) ?? { x: 0, y: 0 });
    const len = Math.hypot(push.x, push.y);
    if (len > bestLen) {
      bestLen = len;
      bestPush = push;
    }
  }

  return bestLen > 1e-6 ? bestPush : null;
}

/** SAT overlap of OBB samples near a barrier edge segment. */
export function obbVsSegmentPenetration(
  obb: ObbState,
  a: Vector2,
  b: Vector2,
  polygon: Vector2[],
): { penetration: number; normal: Vector2 } | null {
  const normal = edgeOutwardNormal(a, b, polygon);
  let maxPen = 0;

  for (const point of obbSurfaceSamples(obb)) {
    maxPen = Math.max(maxPen, sampleSegmentPenetration(point, a, b, normal));
  }

  if (maxPen <= 1e-6) return null;
  return { penetration: maxPen, normal };
}

export function obbVsPolygonContacts(obb: ObbState, polygon: Vector2[]): PolygonContact[] {
  const contacts: PolygonContact[] = [];

  for (let vi = 0; vi < polygon.length; vi++) {
    const vertex = polygon[vi];
    for (let ci = 0; ci < obb.corners.length; ci++) {
      const corner = obb.corners[ci];
      const dist = Math.hypot(corner.x - vertex.x, corner.y - vertex.y);
      if (dist <= VERTEX_RADIUS) {
        const prev = polygon[(vi + polygon.length - 1) % polygon.length];
        contacts.push({
          type: 'vertex',
          point: { ...vertex },
          normal: edgeOutwardNormal(prev, vertex, polygon),
          penetration: VERTEX_RADIUS - dist + CONTACT_SKIN,
          cornerIndex: ci,
          barrierEdgeIndex: (vi + polygon.length - 1) % polygon.length,
          barrierVertexIndex: vi,
        });
      }
    }
  }

  for (let ci = 0; ci < obb.corners.length; ci++) {
    const corner = obb.corners[ci];
    if (pointInPolygon(corner, polygon)) {
      let bestDistSq = Infinity;
      let bestClosest = corner;
      let bestEdge = 0;
      for (let ei = 0; ei < polygon.length; ei++) {
        const a = polygon[ei];
        const b = polygon[(ei + 1) % polygon.length];
        const closest = closestPointOnSegment(corner, a, b);
        const dx = corner.x - closest.x;
        const dy = corner.y - closest.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestClosest = closest;
          bestEdge = ei;
        }
      }
      const a = polygon[bestEdge];
      const b = polygon[(bestEdge + 1) % polygon.length];
      const normal = edgeOutwardNormal(a, b, polygon);
      const dist = Math.hypot(corner.x - bestClosest.x, corner.y - bestClosest.y);
      contacts.push({
        type: 'edge',
        point: bestClosest,
        normal,
        penetration: dist + CONTACT_SKIN,
        cornerIndex: ci,
        barrierEdgeIndex: bestEdge,
      });
      continue;
    }

    for (let ei = 0; ei < polygon.length; ei++) {
      const a = polygon[ei];
      const b = polygon[(ei + 1) % polygon.length];
      const closest = closestPointOnSegment(corner, a, b);
      const dx = corner.x - closest.x;
      const dy = corner.y - closest.y;
      const dist = Math.hypot(dx, dy);
      if (dist > EDGE_MARGIN) continue;

      const nearVertex =
        Math.hypot(closest.x - a.x, closest.y - a.y) < 0.25 ||
        Math.hypot(closest.x - b.x, closest.y - b.y) < 0.25;
      if (nearVertex) continue;

      const normal = edgeOutwardNormal(a, b, polygon);
      contacts.push({
        type: 'edge',
        point: closest,
        normal,
        penetration: EDGE_MARGIN - dist + CONTACT_SKIN,
        cornerIndex: ci,
        barrierEdgeIndex: ei,
      });
    }
  }

  for (let ei = 0; ei < polygon.length; ei++) {
    const a = polygon[ei];
    const b = polygon[(ei + 1) % polygon.length];
    const hit = obbVsSegmentPenetration(obb, a, b, polygon);
    if (!hit) continue;

    let deepestCorner = 0;
    let deepestPen = -Infinity;
    for (let ci = 0; ci < obb.corners.length; ci++) {
      const dist = signedDistanceToEdge(obb.corners[ci], a, hit.normal);
      const pen = CONTACT_SKIN - dist;
      if (pen > deepestPen) {
        deepestPen = pen;
        deepestCorner = ci;
      }
    }

    const alreadyCovered = contacts.some(
      (c) => c.cornerIndex === deepestCorner && c.type === 'edge' && c.barrierEdgeIndex === ei,
    );
    if (alreadyCovered) continue;

    const closest = closestPointOnSegment(obb.corners[deepestCorner], a, b);
    contacts.push({
      type: 'edge',
      point: closest,
      normal: hit.normal,
      penetration: hit.penetration,
      cornerIndex: deepestCorner,
      barrierEdgeIndex: ei,
    });
  }

  contacts.sort((x, y) => {
    const pinX = contactPinDistance(obb, x);
    const pinY = contactPinDistance(obb, y);
    const rank = (c: PolygonContact, pin: number) => {
      if (pin <= PIN_DIST) return 0;
      if (c.type === 'vertex' && pin <= VERTEX_RADIUS) return 1;
      if (c.type === 'edge' && pin <= EDGE_MARGIN + CONTACT_SKIN) return 2;
      return 3;
    };
    const dr = rank(x, pinX) - rank(y, pinY);
    if (dr !== 0) return dr;
    return y.penetration - x.penetration;
  });

  return contacts;
}

/** Minimum translation vector to separate OBB from polygon (deepest edge penetration). */
export function computeSeparationMtv(obb: ObbState, polygon: Vector2[]): Vector2 | null {
  let bestPen = 0;
  let bestNormal: Vector2 | null = null;

  for (let ei = 0; ei < polygon.length; ei++) {
    const a = polygon[ei];
    const b = polygon[(ei + 1) % polygon.length];
    const hit = obbVsSegmentPenetration(obb, a, b, polygon);
    if (!hit || hit.penetration <= bestPen) continue;
    bestPen = hit.penetration;
    bestNormal = hit.normal;
  }

  for (const corner of obb.corners) {
    if (!pointInPolygon(corner, polygon)) continue;
    let bestDistSq = Infinity;
    let bestClosest = corner;
    let bestEdgeNormal: Vector2 | null = null;
    for (let ei = 0; ei < polygon.length; ei++) {
      const a = polygon[ei];
      const b = polygon[(ei + 1) % polygon.length];
      const closest = closestPointOnSegment(corner, a, b);
      const dx = corner.x - closest.x;
      const dy = corner.y - closest.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestClosest = closest;
        bestEdgeNormal = edgeOutwardNormal(a, b, polygon);
      }
    }
    if (!bestEdgeNormal) continue;
    const dist = Math.hypot(corner.x - bestClosest.x, corner.y - bestClosest.y);
    const pen = dist + CONTACT_SKIN;
    if (pen > bestPen) {
      bestPen = pen;
      bestNormal = bestEdgeNormal;
    }
  }

  if (!bestNormal || bestPen <= 1e-6) return null;
  return { x: bestNormal.x * bestPen, y: bestNormal.y * bestPen };
}

function obbSegmentBlocked(
  obb: ObbState,
  a: Vector2,
  b: Vector2,
  polygon: Vector2[],
): boolean {
  const normal = edgeOutwardNormal(a, b, polygon);
  for (const point of obbSurfaceSamples(obb)) {
    const closest = closestPointOnSegment(point, a, b);
    const segDist = Math.hypot(point.x - closest.x, point.y - closest.y);
    if (segDist > EDGE_MARGIN + CONTACT_SKIN) continue;

    const planeDist = signedDistanceToEdge(point, a, normal);
    if (planeDist < -CONTACT_SKIN) return true;
  }

  return false;
}

export function obbPenetratingPolygon(obb: ObbState, polygon: Vector2[]): boolean {
  for (const sample of obbSurfaceSamples(obb)) {
    if (pointInPolygon(sample, polygon)) return true;
  }
  for (let ei = 0; ei < polygon.length; ei++) {
    const a = polygon[ei];
    const b = polygon[(ei + 1) % polygon.length];
    if (obbSegmentBlocked(obb, a, b, polygon)) return true;
  }
  return false;
}

export function obbClearOfPolygon(obb: ObbState, polygon: Vector2[]): boolean {
  for (const sample of obbSurfaceSamples(obb)) {
    if (pointInPolygon(sample, polygon)) return false;
  }
  for (let ei = 0; ei < polygon.length; ei++) {
    const a = polygon[ei];
    const b = polygon[(ei + 1) % polygon.length];
    if (obbSegmentBlocked(obb, a, b, polygon)) return false;
  }
  return true;
}

export function obbPenetratingObb(a: ObbState, b: ObbState): boolean {
  if (obbPenetratingPolygon(a, b.corners)) return true;
  if (obbPenetratingPolygon(b, a.corners)) return true;
  return false;
}

export function rotateLocalOffset(offset: Vector2, heading: number): Vector2 {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos,
  };
}

export function snapCornerToPoint(pose: Pose, cornerLocal: Vector2, target: Vector2): Pose {
  const offset = rotateLocalOffset(cornerLocal, pose.heading);
  return {
    x: target.x - offset.x,
    y: target.y - offset.y,
    heading: pose.heading,
  };
}
