import type { Pose, Vector2 } from '@ftc-sim/field';
import { normalizeAngle } from '@ftc-sim/field';
import type { RobotFootprint } from './types.js';
import {
  buildObb,
  computeSeparationMtv,
  deepestObbSeparationPush,
  CONTACT_SKIN,
  edgeOutwardNormal,
  EDGE_MARGIN,
  obbClearOfPolygon,
  obbPenetratingObb,
  obbPenetratingPolygon,
  obbSurfaceSamples,
  obbVsPolygonContacts,
  pointInPolygon,
  rotateLocalOffset,
  closestPointOnSegment,
  contactPinDistance,
  VERTEX_RADIUS,
  type ObbState,
  type PolygonContact,
} from './obb-sat.js';

function pushObbOutOfPolygon(pose: Pose, footprint: RobotFootprint, polygon: Vector2[]): Pose | null {
  const obb = buildObb(pose, footprint);
  const push = deepestObbSeparationPush(obb, polygon);
  if (!push) return null;

  const len = Math.hypot(push.x, push.y);
  const scale = Math.min(1, DEEP_CORRECTION_PER_PASS / len);
  return {
    x: pose.x + push.x * scale,
    y: pose.y + push.y * scale,
    heading: pose.heading,
  };
}

function applyBoundedMtv(pose: Pose, mtv: Vector2, maxStep = SKIN_CORRECTION_PER_PASS): Pose {
  const len = Math.hypot(mtv.x, mtv.y);
  if (len < 1e-6) return pose;
  const scale = Math.min(1, maxStep / len) * POSITION_BETA;
  return {
    x: pose.x + mtv.x * scale,
    y: pose.y + mtv.y * scale,
    heading: pose.heading,
  };
}

function hasCornerInside(pose: Pose, footprint: RobotFootprint, polygon: Vector2[]): boolean {
  const obb = buildObb(pose, footprint);
  return obb.corners.some((corner) => pointInPolygon(corner, polygon));
}

export { pointInPolygon } from './obb-sat.js';

export interface BarrierMotionState {
  pose: Pose;
  linear: Vector2;
  angular: number;
}

const POSITION_BETA = 0.9;
const MAX_POSITION_PASSES = 16;
const DEEP_CORRECTION_PER_PASS = 1.0;
const SKIN_CORRECTION_PER_PASS = 0.12;
const MAX_FRAME_POSITION_CORRECTION = 1.5;
const MAX_VELOCITY_PASSES = 2;
const PIN_DIST = 0.2;
/** VERTEX_RADIUS + CONTACT_SKIN — literal avoids circular import init order with obb-sat. */
const PIVOT_PIN_DIST = 0.83;
/** Into-wall speed (in/s) before contact breaks into tangential slip along the edge. */
const SLIP_BREAK_INTO = 5;
const SLIP_TANGENT_GAIN = 0.45;
const KINETIC_INTO_FRACTION = 0.12;
/** Pivot hinge cannot rotate enough to satisfy desired drive — treat as wedge, not revolute lock. */
const DEAD_PIVOT_OMEGA = 0.5;
const DEAD_PIVOT_MIN_SPEED = 1.5;
const VERTEX_ESCAPE_PUSH = 0.45;

function cornerWorldVelocity(
  vx: number,
  vy: number,
  omega: number,
  cornerLocal: Vector2,
  heading: number,
): Vector2 {
  const offset = rotateLocalOffset(cornerLocal, heading);
  return {
    x: vx - omega * offset.y,
    y: vy + omega * offset.x,
  };
}

export function hasActiveBarrierContact(
  pose: Pose,
  footprint: RobotFootprint,
  barriers: Vector2[][],
): boolean {
  const obb = buildObb(pose, footprint);
  for (const polygon of barriers) {
    if (obbVsPolygonContacts(obb, polygon).length > 0) return true;
  }
  return false;
}

function isPenetrating(pose: Pose, footprint: RobotFootprint, barriers: Vector2[][]): boolean {
  return barriers.some((polygon) => hasCornerInside(pose, footprint, polygon));
}

function isSkinOverlap(pose: Pose, footprint: RobotFootprint, barriers: Vector2[][]): boolean {
  if (isPenetrating(pose, footprint, barriers)) return false;
  const obb = buildObb(pose, footprint);
  return barriers.some((polygon) => !obbClearOfPolygon(obb, polygon));
}

function contactConstraintScore(
  obb: ObbState,
  contact: PolygonContact,
  desiredVx: number,
  desiredVy: number,
  desiredOmega: number,
): number {
  const cornerLocal = obb.locals[contact.cornerIndex];
  const vCorner = cornerWorldVelocity(
    desiredVx,
    desiredVy,
    desiredOmega,
    cornerLocal,
    obb.pose.heading,
  );
  const into = vCorner.x * contact.normal.x + vCorner.y * contact.normal.y;
  const pinDist = contactPinDistance(obb, contact);

  let score = contact.penetration + Math.max(0, -into) * 0.05;
  if (pinDist <= PIN_DIST) score += 5;
  else if (pinDist <= EDGE_MARGIN + CONTACT_SKIN) score += 2;
  if (contact.type === 'vertex' && pinDist <= VERTEX_RADIUS) score += 1;
  return score;
}

/** Omega that best matches desired center velocity while rotating about a fixed world corner. */
export function omegaForPivotAboutCorner(
  desiredVx: number,
  desiredVy: number,
  cornerLocal: Vector2,
  heading: number,
): number {
  const offset = rotateLocalOffset(cornerLocal, heading);
  const denom = offset.x * offset.x + offset.y * offset.y;
  if (denom < 1e-4) return 0;
  return (desiredVx * offset.y - desiredVy * offset.x) / denom;
}

export interface PinnedCornerPivot {
  contact: PolygonContact;
  cornerLocal: Vector2;
  pivot: Vector2;
}

/** Corner pinned at a goal vertex — hinge is the robot corner, not the barrier sample point. */
export function findPinnedCornerPivot(
  pose: Pose,
  footprint: RobotFootprint,
  barriers: Vector2[][],
  desiredVx: number,
  desiredVy: number,
  desiredOmega: number,
): PinnedCornerPivot | null {
  const obb = buildObb(pose, footprint);
  let best: (PinnedCornerPivot & { score: number }) | null = null;

  for (const polygon of barriers) {
    for (const contact of obbVsPolygonContacts(obb, polygon)) {
      if (contact.type !== 'vertex') continue;

      const pinDist = contactPinDistance(obb, contact);
      if (pinDist > PIVOT_PIN_DIST) continue;

      const cornerLocal = obb.locals[contact.cornerIndex];
      const vDesired = cornerWorldVelocity(
        desiredVx,
        desiredVy,
        desiredOmega,
        cornerLocal,
        pose.heading,
      );
      const into = vDesired.x * contact.normal.x + vDesired.y * contact.normal.y;
      if (into >= -0.05) continue;

      const desiredSpeed = Math.hypot(desiredVx, desiredVy);
      const pivotOmega = omegaForPivotAboutCorner(desiredVx, desiredVy, cornerLocal, pose.heading);
      if (
        desiredSpeed > DEAD_PIVOT_MIN_SPEED &&
        Math.abs(pivotOmega) < DEAD_PIVOT_OMEGA
      ) {
        continue;
      }

      const score = contactConstraintScore(obb, contact, desiredVx, desiredVy, desiredOmega);
      if (!best || score > best.score) {
        best = {
          contact,
          cornerLocal,
          pivot: { ...obb.corners[contact.cornerIndex] },
          score,
        };
      }
    }
  }

  return best ? { contact: best.contact, cornerLocal: best.cornerLocal, pivot: best.pivot } : null;
}

/** Push robot off a vertex wedge when revolute pivot cannot satisfy desired motion. */
function tryEscapeVertexWedge(
  pose: Pose,
  footprint: RobotFootprint,
  barriers: Vector2[][],
  desiredVx: number,
  desiredVy: number,
): Pose | null {
  const obb = buildObb(pose, footprint);
  const desiredSpeed = Math.hypot(desiredVx, desiredVy);
  if (desiredSpeed < DEAD_PIVOT_MIN_SPEED) return null;

  for (const polygon of barriers) {
    for (const contact of obbVsPolygonContacts(obb, polygon)) {
      if (contact.type !== 'vertex') continue;
      if (contactPinDistance(obb, contact) > PIVOT_PIN_DIST) continue;

      const cornerLocal = obb.locals[contact.cornerIndex];
      const pivotOmega = omegaForPivotAboutCorner(desiredVx, desiredVy, cornerLocal, pose.heading);
      if (Math.abs(pivotOmega) >= DEAD_PIVOT_OMEGA) continue;

      const push = deepestObbSeparationPush(obb, polygon);
      if (!push) continue;

      const len = Math.hypot(push.x, push.y);
      if (len < 1e-6) continue;
      const step = Math.min(len, VERTEX_ESCAPE_PUSH);
      return {
        x: pose.x + (push.x / len) * step,
        y: pose.y + (push.y / len) * step,
        heading: pose.heading,
      };
    }
  }
  return null;
}

/**
 * Integrate one step rotating about a fixed world corner (revolute hinge).
 * Keeps the corner world position fixed — no velocity snap + separate translate.
 */
export function stepPivotAboutCorner(
  pose: Pose,
  cornerLocal: Vector2,
  pivot: Vector2,
  omega: number,
  dt: number,
): BarrierMotionState {
  const nextHeading = normalizeAngle(pose.heading + omega * dt);
  const nextOffset = rotateLocalOffset(cornerLocal, nextHeading);
  const nextPose: Pose = {
    x: pivot.x - nextOffset.x,
    y: pivot.y - nextOffset.y,
    heading: nextHeading,
  };

  return {
    pose: nextPose,
    linear: { x: omega * nextOffset.y, y: -omega * nextOffset.x },
    angular: omega,
  };
}

function edgeTangentUnit(contact: PolygonContact, polygon: Vector2[]): Vector2 {
  const a = polygon[contact.barrierEdgeIndex];
  const b = polygon[(contact.barrierEdgeIndex + 1) % polygon.length];
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  return { x: tx / len, y: ty / len };
}

function pickEdgeTangent(
  tangent: Vector2,
  desiredVx: number,
  desiredVy: number,
): Vector2 {
  const along = desiredVx * tangent.x + desiredVy * tangent.y;
  if (along >= 0) return tangent;
  return { x: -tangent.x, y: -tangent.y };
}

function solveBodyFromCornerVelocity(
  vx: number,
  vy: number,
  omega: number,
  targetCornerVx: number,
  targetCornerVy: number,
  cornerLocal: Vector2,
  heading: number,
): { vx: number; vy: number; omega: number } {
  const r = rotateLocalOffset(cornerLocal, heading);
  const relVx = targetCornerVx - vx;
  const relVy = targetCornerVy - vy;
  const det = r.x * r.x + r.y * r.y;
  let nextOmega = omega;
  if (det > 1e-4) {
    nextOmega = (r.x * relVy - r.y * relVx) / det;
  }
  return {
    vx: targetCornerVx + nextOmega * r.y,
    vy: targetCornerVy - nextOmega * r.x,
    omega: nextOmega,
  };
}

function solveEdgeSlideVelocity(
  vx: number,
  vy: number,
  omega: number,
  contact: PolygonContact,
  cornerLocal: Vector2,
  heading: number,
  polygon: Vector2[],
  desiredVx: number,
  desiredVy: number,
  desiredOmega: number,
): { vx: number; vy: number; omega: number } {
  const offset = rotateLocalOffset(cornerLocal, heading);
  const r = { x: offset.x, y: offset.y };
  const vCorner = cornerWorldVelocity(vx, vy, omega, cornerLocal, heading);
  const vDesired = cornerWorldVelocity(
    desiredVx,
    desiredVy,
    desiredOmega,
    cornerLocal,
    heading,
  );
  const into = vCorner.x * contact.normal.x + vCorner.y * contact.normal.y;
  const intoDesired = vDesired.x * contact.normal.x + vDesired.y * contact.normal.y;

  if (into >= 0 && intoDesired >= 0) return { vx, vy, omega };

  const source = intoDesired < -0.01 ? vDesired : vCorner;
  const sourceInto = intoDesired < -0.01 ? intoDesired : into;

  let targetCornerVx = source.x - sourceInto * contact.normal.x;
  let targetCornerVy = source.y - sourceInto * contact.normal.y;

  if (intoDesired < -SLIP_BREAK_INTO) {
    const tangent = pickEdgeTangent(edgeTangentUnit(contact, polygon), desiredVx, desiredVy);
    const tangDesired =
      vDesired.x * tangent.x + vDesired.y * tangent.y;
    const excess = -intoDesired - SLIP_BREAK_INTO;
    const slipSpeed = tangDesired + Math.sign(tangDesired || tangent.x || 1) * excess * SLIP_TANGENT_GAIN;
    targetCornerVx = tangent.x * slipSpeed + contact.normal.x * (-SLIP_BREAK_INTO * KINETIC_INTO_FRACTION);
    targetCornerVy = tangent.y * slipSpeed + contact.normal.y * (-SLIP_BREAK_INTO * KINETIC_INTO_FRACTION);
  }

  return solveBodyFromCornerVelocity(
    vx,
    vy,
    omega,
    targetCornerVx,
    targetCornerVy,
    cornerLocal,
    heading,
  );
}

export function resolveBarrierPosition(
  pose: Pose,
  barriers: Vector2[][],
  footprint: RobotFootprint,
  options?: { maxPasses?: number; maxTotalCorrection?: number },
): Pose {
  if (barriers.length === 0) return pose;

  const maxPasses = options?.maxPasses ?? MAX_POSITION_PASSES;
  const maxTotal = options?.maxTotalCorrection ?? Infinity;
  let next = { ...pose };
  let totalMoved = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const obb = buildObb(next, footprint);
    if (barriers.every((polygon) => obbClearOfPolygon(obb, polygon))) break;
    if (totalMoved >= maxTotal) break;

    let moved = false;
    for (const polygon of barriers) {
      const deep = hasCornerInside(next, footprint, polygon);

      if (deep) {
        const pushed = pushObbOutOfPolygon(next, footprint, polygon);
        if (pushed) {
          const step = Math.hypot(pushed.x - next.x, pushed.y - next.y);
          const budget = maxTotal - totalMoved;
          if (step > budget) {
            const scale = budget / step;
            next = {
              x: next.x + (pushed.x - next.x) * scale,
              y: next.y + (pushed.y - next.y) * scale,
              heading: next.heading,
            };
            totalMoved = maxTotal;
          } else {
            next = pushed;
            totalMoved += step;
          }
          moved = true;
          break;
        }
      }

      const mtv = computeSeparationMtv(buildObb(next, footprint), polygon);
      if (mtv) {
        const before = next;
        next = applyBoundedMtv(next, mtv, deep ? DEEP_CORRECTION_PER_PASS : SKIN_CORRECTION_PER_PASS);
        totalMoved += Math.hypot(next.x - before.x, next.y - before.y);
        moved = true;
        break;
      }
    }

    if (!moved) break;
  }

  return next;
}

export function resolveBarrierVelocity(
  pose: Pose,
  linear: Vector2,
  angular: number,
  barriers: Vector2[][],
  footprint: RobotFootprint,
  _dt: number,
  desiredLinear?: Vector2,
  desiredAngular?: number,
): BarrierMotionState {
  const desiredVx = desiredLinear?.x ?? linear.x;
  const desiredVy = desiredLinear?.y ?? linear.y;
  const desiredOmega = desiredAngular ?? angular;

  let nextVx = linear.x;
  let nextVy = linear.y;
  let nextOmega = angular;
  const obb = buildObb(pose, footprint);

  for (let pass = 0; pass < MAX_VELOCITY_PASSES; pass++) {
    let best: { contact: PolygonContact; polygon: Vector2[]; score: number } | null = null;

    for (const polygon of barriers) {
      for (const contact of obbVsPolygonContacts(obb, polygon)) {
        const cornerLocal = obb.locals[contact.cornerIndex];
        const vCorner = cornerWorldVelocity(
          nextVx,
          nextVy,
          nextOmega,
          cornerLocal,
          pose.heading,
        );
        const into = vCorner.x * contact.normal.x + vCorner.y * contact.normal.y;
        const vDesired = cornerWorldVelocity(
          desiredVx,
          desiredVy,
          desiredOmega,
          cornerLocal,
          pose.heading,
        );
        const intoDesired = vDesired.x * contact.normal.x + vDesired.y * contact.normal.y;
        if (into >= -0.01 && intoDesired >= -0.01) continue;

        const score = contactConstraintScore(obb, contact, desiredVx, desiredVy, desiredOmega);
        if (!best || score > best.score) {
          best = { contact, polygon, score };
        }
      }
    }

    if (!best) break;

    const cornerLocal = obb.locals[best.contact.cornerIndex];
    const slide = solveEdgeSlideVelocity(
      nextVx,
      nextVy,
      nextOmega,
      best.contact,
      cornerLocal,
      pose.heading,
      best.polygon,
      desiredVx,
      desiredVy,
      desiredOmega,
    );
    nextVx = slide.vx;
    nextVy = slide.vy;
    nextOmega = slide.omega;
  }

  return {
    pose,
    linear: { x: nextVx, y: nextVy },
    angular: nextOmega,
  };
}

export function clampHolonomicVelocityToBarriers(
  pose: Pose,
  footprint: RobotFootprint,
  desiredVx: number,
  desiredVy: number,
  barriers: Vector2[][],
  margin = 1.2,
): { vx: number; vy: number } {
  if (barriers.length === 0) return { vx: desiredVx, vy: desiredVy };

  const inContact = hasActiveBarrierContact(pose, footprint, barriers);
  const obb = buildObb(pose, footprint);
  let vx = desiredVx;
  let vy = desiredVy;

  for (const polygon of barriers) {
    for (let ei = 0; ei < polygon.length; ei++) {
      const a = polygon[ei];
      const b = polygon[(ei + 1) % polygon.length];
      const normal = edgeOutwardNormal(a, b, polygon);

      let minClearance = Infinity;
      for (const sample of obbSurfaceSamples(obb)) {
        const closest = closestPointOnSegment(sample, a, b);
        const segDist = Math.hypot(sample.x - closest.x, sample.y - closest.y);
        if (segDist > margin * 2 + EDGE_MARGIN) continue;
        const dist = (sample.x - a.x) * normal.x + (sample.y - a.y) * normal.y;
        minClearance = Math.min(minClearance, dist);
      }

      if (!Number.isFinite(minClearance)) continue;

      const into = vx * normal.x + vy * normal.y;
      if (into >= 0 || minClearance >= margin * 2) continue;

      if (inContact) {
        if (into < 0) {
          vx -= into * normal.x;
          vy -= into * normal.y;
        }
        continue;
      }

      let scale = 1;
      if (minClearance <= margin) {
        scale = 0;
      } else {
        scale = (minClearance - margin) / margin;
      }

      const strippedInto = into * (1 - scale);
      vx -= strippedInto * normal.x;
      vy -= strippedInto * normal.y;
    }
  }

  return { vx, vy };
}

export function resolveBarrierPhysics(
  pose: Pose,
  linear: Vector2,
  angular: number,
  barriers: Vector2[][],
  footprint: RobotFootprint,
  dt = 1 / 120,
  desiredLinear?: Vector2,
  desiredAngular?: number,
): BarrierMotionState {
  if (barriers.length === 0) {
    return {
      pose: {
        x: pose.x + linear.x * dt,
        y: pose.y + linear.y * dt,
        heading: normalizeAngle(pose.heading + angular * dt),
      },
      linear: { ...linear },
      angular,
    };
  }

  const desired = desiredLinear ?? linear;
  const desiredOm = desiredAngular ?? angular;

  const speed = Math.hypot(linear.x, linear.y);
  const stepDist = speed * dt;
  const substeps =
    stepDist > CONTACT_SKIN ? Math.min(4, Math.ceil(stepDist / (CONTACT_SKIN * 0.4))) : 1;
  const subDt = dt / substeps;

  let nextPose = { ...pose };
  let nextVx = linear.x;
  let nextVy = linear.y;
  let nextOmega = angular;

  const penetrating = isPenetrating(pose, footprint, barriers);
  const skinOverlap = isSkinOverlap(pose, footprint, barriers);
  const posBudget = penetrating ? Infinity : MAX_FRAME_POSITION_CORRECTION;
  const posPasses = penetrating ? MAX_POSITION_PASSES : skinOverlap ? 2 : 0;

  for (let s = 0; s < substeps; s++) {
    const pivot = findPinnedCornerPivot(
      nextPose,
      footprint,
      barriers,
      desired.x,
      desired.y,
      desiredOm,
    );

    if (pivot) {
      const omega = omegaForPivotAboutCorner(
        desired.x,
        desired.y,
        pivot.cornerLocal,
        nextPose.heading,
      );
      const desiredSpeed = Math.hypot(desired.x, desired.y);
      const pivotDead =
        desiredSpeed > DEAD_PIVOT_MIN_SPEED && Math.abs(omega) < DEAD_PIVOT_OMEGA;

      if (pivotDead) {
        const escaped = tryEscapeVertexWedge(
          nextPose,
          footprint,
          barriers,
          desired.x,
          desired.y,
        );
        if (escaped) {
          nextPose = escaped;
        }

        const vel = resolveBarrierVelocity(
          nextPose,
          { x: nextVx, y: nextVy },
          nextOmega,
          barriers,
          footprint,
          subDt,
          desired,
          desiredOm,
        );
        nextVx = vel.linear.x;
        nextVy = vel.linear.y;
        nextOmega = vel.angular;

        nextPose = {
          x: nextPose.x + nextVx * subDt,
          y: nextPose.y + nextVy * subDt,
          heading: normalizeAngle(nextPose.heading + nextOmega * subDt),
        };

        if (isPenetrating(nextPose, footprint, barriers) || isSkinOverlap(nextPose, footprint, barriers)) {
          nextPose = resolveBarrierPosition(nextPose, barriers, footprint, {
            maxPasses: posPasses,
            maxTotalCorrection: posBudget / substeps,
          });
        }
        continue;
      }

      const stepped = stepPivotAboutCorner(
        nextPose,
        pivot.cornerLocal,
        pivot.pivot,
        omega,
        subDt,
      );
      nextPose = stepped.pose;
      nextVx = stepped.linear.x;
      nextVy = stepped.linear.y;
      nextOmega = stepped.angular;

      if (isPenetrating(nextPose, footprint, barriers) || isSkinOverlap(nextPose, footprint, barriers)) {
        nextPose = resolveBarrierPosition(nextPose, barriers, footprint, {
          maxPasses: posPasses,
          maxTotalCorrection: posBudget / substeps,
        });
      }
      continue;
    }

    const vel = resolveBarrierVelocity(
      nextPose,
      { x: nextVx, y: nextVy },
      nextOmega,
      barriers,
      footprint,
      subDt,
      desired,
      desiredOm,
    );
    nextVx = vel.linear.x;
    nextVy = vel.linear.y;
    nextOmega = vel.angular;

    nextPose = {
      x: nextPose.x + nextVx * subDt,
      y: nextPose.y + nextVy * subDt,
      heading: normalizeAngle(nextPose.heading + nextOmega * subDt),
    };

    if (isPenetrating(nextPose, footprint, barriers) || isSkinOverlap(nextPose, footprint, barriers)) {
      nextPose = resolveBarrierPosition(nextPose, barriers, footprint, {
        maxPasses: posPasses,
        maxTotalCorrection: posBudget / substeps,
      });
    }
  }

  return {
    pose: nextPose,
    linear: { x: nextVx, y: nextVy },
    angular: nextOmega,
  };
}

export function resolveBarrierCollisions(
  pose: Pose,
  barriers: Vector2[][],
  footprint: RobotFootprint,
): Pose {
  return resolveBarrierPosition(pose, barriers, footprint);
}

/** Push a dynamic robot out of static robot footprints (NPC / alliance partners). */
export function resolveRobotObstacleCollisions(
  pose: Pose,
  footprint: RobotFootprint,
  obstacles: Vector2[][],
  maxPasses = 4,
): Pose {
  let next = pose;
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (const polygon of obstacles) {
      const pushed = pushObbOutOfPolygon(next, footprint, polygon);
      if (pushed) {
        next = pushed;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return next;
}

export interface MutableRobotBody {
  pose: Pose;
  linear: Vector2;
  angular: number;
  footprint: RobotFootprint;
}

const ROBOT_PUSH_TRANSFER = 0.6;
const ROBOT_SEPARATION_SCALE = 0.9;

function applyRobotPushExchange(
  a: MutableRobotBody,
  b: MutableRobotBody,
  sepMtv: Vector2,
  exchangeScale = 1,
): void {
  const len = Math.hypot(sepMtv.x, sepMtv.y);
  if (len < 1e-6) return;
  const nx = sepMtv.x / len;
  const ny = sepMtv.y / len;

  const relVx = a.linear.x - b.linear.x;
  const relVy = a.linear.y - b.linear.y;
  const relNormal = relVx * nx + relVy * ny;
  if (relNormal >= 0) return;

  const impulse = -relNormal * ROBOT_PUSH_TRANSFER * exchangeScale;
  a.linear.x += nx * impulse;
  a.linear.y += ny * impulse;
  b.linear.x -= nx * impulse;
  b.linear.y -= ny * impulse;
}

export interface MutualCollisionOptions {
  /** Index of the human-driven robot (typically 0 in stepMultiRobotDrive). */
  playerIndex?: number;
  /** Fraction of positional separation applied to non-player bodies (default 0.5). */
  npcSeparationShare?: number;
  /** Reduce momentum theft when a fast robot hits a nearly stopped partner. */
  dampExchangeForStatic?: boolean;
}

/** Separate overlapping robots and transfer push velocity between them. */
export function resolveMutualRobotCollisions(
  robots: MutableRobotBody[],
  maxPasses = 8,
  options: MutualCollisionOptions = {},
): void {
  const playerIndex = options.playerIndex ?? -1;
  const npcShare = options.npcSeparationShare ?? 0.5;
  const dampStatic = options.dampExchangeForStatic ?? false;
  const STATIC_SPEED = 5;

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < robots.length; i++) {
      for (let j = i + 1; j < robots.length; j++) {
        const a = robots[i]!;
        const b = robots[j]!;
        const obbA = buildObb(a.pose, a.footprint);
        const obbB = buildObb(b.pose, b.footprint);
        if (!obbPenetratingObb(obbA, obbB)) continue;

        const pushA = deepestObbSeparationPush(obbA, obbB.corners);
        const pushB = deepestObbSeparationPush(obbB, obbA.corners);

        const push = pushA ?? (pushB ? { x: -pushB.x, y: -pushB.y } : null);
        if (!push) continue;

        const len = Math.hypot(push.x, push.y);
        if (len < 1e-6) continue;
        const beta = Math.min(1, 0.35 / len) * ROBOT_SEPARATION_SCALE * 0.5;
        let dx = push.x * beta;
        let dy = push.y * beta;

        let aShare = 0.5;
        let bShare = 0.5;
        if (playerIndex >= 0) {
          if (i === playerIndex && j !== playerIndex) {
            aShare = 1 - npcShare;
            bShare = npcShare;
          } else if (j === playerIndex && i !== playerIndex) {
            aShare = npcShare;
            bShare = 1 - npcShare;
          }
        }

        const beforeDistSq =
          (a.pose.x - b.pose.x) * (a.pose.x - b.pose.x) + (a.pose.y - b.pose.y) * (a.pose.y - b.pose.y);
        let afterDistSq =
          (a.pose.x + dx * aShare - (b.pose.x - dx * bShare)) *
            (a.pose.x + dx * aShare - (b.pose.x - dx * bShare)) +
          (a.pose.y + dy * aShare - (b.pose.y - dy * bShare)) *
            (a.pose.y + dy * aShare - (b.pose.y - dy * bShare));
        if (afterDistSq <= beforeDistSq) {
          dx = -dx;
          dy = -dy;
        }

        a.pose = { x: a.pose.x + dx * aShare, y: a.pose.y + dy * aShare, heading: a.pose.heading };
        b.pose = { x: b.pose.x - dx * bShare, y: b.pose.y - dy * bShare, heading: b.pose.heading };

        let exchangeScale = 1;
        if (dampStatic) {
          const aSpeed = Math.hypot(a.linear.x, a.linear.y);
          const bSpeed = Math.hypot(b.linear.x, b.linear.y);
          if (aSpeed < STATIC_SPEED && bSpeed >= STATIC_SPEED) {
            exchangeScale = 0.2;
          } else if (bSpeed < STATIC_SPEED && aSpeed >= STATIC_SPEED) {
            exchangeScale = 0.2;
          }
          if (playerIndex >= 0) {
            const playerIsA = i === playerIndex;
            const playerIsB = j === playerIndex;
            if (playerIsA || playerIsB) {
              exchangeScale = Math.min(exchangeScale, 0.25);
            }
          }
        }

        applyRobotPushExchange(a, b, { x: dx / beta, y: dy / beta }, exchangeScale);
        moved = true;
      }
    }
    if (!moved) break;
  }
}
