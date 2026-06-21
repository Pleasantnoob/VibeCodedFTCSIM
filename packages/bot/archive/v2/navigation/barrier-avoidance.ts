import type { Pose, Vector2 } from '@ftc-sim/field';
import type { HolonomicInput } from '@ftc-sim/robot';
import type { RobotFootprint } from '@ftc-sim/robot';
import { buildObb } from '@ftc-sim/robot';

const PROBE_DIST = 10;
const SLIDE_STRENGTH = 0.8;

function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
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

function closestPointOnSegment(point: Vector2, a: Vector2, b: Vector2): Vector2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return { ...a };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
  return { x: a.x + t * abx, y: a.y + t * aby };
}

function edgeOutwardNormal(a: Vector2, b: Vector2, polygon: Vector2[]): Vector2 {
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

function fieldVelocityFromInput(input: HolonomicInput): Vector2 {
  return { x: input.strafe ?? 0, y: input.forward };
}

function inputFromFieldVelocity(input: HolonomicInput, vx: number, vy: number): HolonomicInput {
  return {
    ...input,
    forward: Math.max(-1, Math.min(1, vy)),
    strafe: Math.max(-1, Math.min(1, vx)),
  };
}

/** SAT-inspired slide: remove velocity component pushing into nearby barrier edges. */
export function applyBarrierSlide(
  input: HolonomicInput,
  pose: Pose,
  footprint: RobotFootprint,
  barriers: Vector2[][],
): HolonomicInput {
  if (barriers.length === 0) return input;

  const obb = buildObb(pose, footprint);
  let vx = fieldVelocityFromInput(input).x;
  let vy = fieldVelocityFromInput(input).y;

  for (const polygon of barriers) {
    if (polygon.length < 3) continue;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const normal = edgeOutwardNormal(a, b, polygon);

      for (const sample of obb.corners) {
        const closest = closestPointOnSegment(sample, a, b);
        const dist = Math.hypot(sample.x - closest.x, sample.y - closest.y);
        if (dist > PROBE_DIST) continue;

        const probe = { x: sample.x + normal.x * 0.5, y: sample.y + normal.y * 0.5 };
        if (pointInPolygon(probe, polygon)) continue;

        const push = vx * normal.x + vy * normal.y;
        if (push >= 0) continue;
        const urgency = SLIDE_STRENGTH * (1 - dist / PROBE_DIST);
        vx -= normal.x * push * urgency;
        vy -= normal.y * push * urgency;
      }
    }
  }

  return inputFromFieldVelocity(input, vx, vy);
}
