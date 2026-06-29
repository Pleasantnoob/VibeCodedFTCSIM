import type { Pose, Vector2 } from './types.js';

export const FIELD_SIZE_INCHES = 144;
/** @deprecated Use {@link FIELD_SIZE_INCHES}. Pedro 1.2+ and the visualizer use 0–144 in. */
export const VISUAL_FIELD_SIZE_INCHES = FIELD_SIZE_INCHES;
/** @deprecated Identity — kept for legacy imports only (see {@link packages/pedro VISUALIZER_TO_PEDRO}). */
export const VISUAL_SCALE = 1;
export const INCHES_TO_METERS = 0.0254;
export const FIELD_HALF_METERS = (FIELD_SIZE_INCHES / 2) * INCHES_TO_METERS;

export function pedroPointToPhysics(point: Vector2): Vector2 {
  return {
    x: point.x * INCHES_TO_METERS - FIELD_HALF_METERS,
    y: point.y * INCHES_TO_METERS - FIELD_HALF_METERS,
  };
}

/** Pedro bottom-left origin → physics center origin in meters */
export function pedroToPhysics(pose: Pose): Pose {
  return {
    x: pose.x * INCHES_TO_METERS - FIELD_HALF_METERS,
    y: pose.y * INCHES_TO_METERS - FIELD_HALF_METERS,
    heading: pose.heading,
  };
}

/** Physics center origin in meters → Pedro inches */
export function physicsToPedro(pose: Pose): Pose {
  return {
    x: (pose.x + FIELD_HALF_METERS) / INCHES_TO_METERS,
    y: (pose.y + FIELD_HALF_METERS) / INCHES_TO_METERS,
    heading: pose.heading,
  };
}

/** FTC SDK center origin (inches) → Pedro */
export function ftcDecodeToPedro(pose: Pose): Pose {
  return {
    x: -pose.x + FIELD_SIZE_INCHES / 2,
    y: -pose.y + FIELD_SIZE_INCHES / 2,
    heading: normalizeAngle(Math.PI / 2 - pose.heading),
  };
}

/** Pedro → FTC SDK center origin (inches) */
export function pedroToFtcDecode(pose: Pose): Pose {
  const ftcX = FIELD_SIZE_INCHES / 2 - pose.x;
  const ftcY = FIELD_SIZE_INCHES / 2 - pose.y;
  return {
    x: ftcX,
    y: ftcY,
    heading: normalizeAngle(Math.PI / 2 - pose.heading),
  };
}

export function normalizeAngle(radians: number): number {
  let a = radians % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export function distance(p1: Vector2, p2: Vector2): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function headingToVector(heading: number): Vector2 {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

export function rotateVector(v: Vector2, angle: number): Vector2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function clampPedroPoint(point: Vector2): Vector2 {
  return {
    x: Math.max(0, Math.min(FIELD_SIZE_INCHES, point.x)),
    y: Math.max(0, Math.min(FIELD_SIZE_INCHES, point.y)),
  };
}
