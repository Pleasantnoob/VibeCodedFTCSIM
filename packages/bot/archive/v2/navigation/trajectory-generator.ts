import type { Pose, Vector2 } from '@ftc-sim/field';
import { normalizeAngle } from '@ftc-sim/field';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';

export function pathWaypointsSignature(waypoints: Vector2[]): string {
  const stablePoints = waypoints.length > 2 ? waypoints.slice(1) : waypoints;
  return stablePoints.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join('|');
}

const LOOKAHEAD_IN = 14;
const SLOW_RADIUS_IN = 24;
const GOAL_TOLERANCE_IN = 2.5;
const OFF_PATH_DIRECT_IN = 22;

function nearestPathPoint(path: Vector2[], pose: Pose): { point: Vector2; dist: number } {
  if (path.length === 0) {
    return { point: { x: pose.x, y: pose.y }, dist: 0 };
  }
  let best = path[0]!;
  let bestDist = Math.hypot(best.x - pose.x, best.y - pose.y);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lenSq = abX * abX + abY * abY;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((pose.x - a.x) * abX + (pose.y - a.y) * abY) / lenSq));
    const point = { x: a.x + abX * t, y: a.y + abY * t };
    const dist = Math.hypot(point.x - pose.x, point.y - pose.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return { point: best, dist: bestDist };
}

export interface TrajectoryState {
  waypointIndex: number;
  path: Vector2[];
  finalHeading?: number;
}

export interface TrajectoryDebug {
  waypointIndex: number;
  pathLength: number;
  pursuitTarget: Vector2 | null;
  pathGoal: Vector2 | null;
  distToGoal: number;
  distToPursuit: number;
  speedScale: number;
  atEndpoint: boolean;
}

export function createTrajectoryState(): TrajectoryState {
  return { waypointIndex: 0, path: [] };
}

export function setTrajectoryPath(
  state: TrajectoryState,
  path: Vector2[],
  finalHeading?: number,
): void {
  state.path = path.map((point) => ({ ...point }));
  state.waypointIndex = Math.min(state.waypointIndex, Math.max(0, state.path.length - 1));
  state.finalHeading = finalHeading;
  if (state.path.length > 0) {
    state.waypointIndex = 0;
  }
}

function advanceWaypoint(state: TrajectoryState, pose: Pose, radius = 6): void {
  while (state.waypointIndex < state.path.length - 1) {
    const wp = state.path[state.waypointIndex]!;
    if (Math.hypot(pose.x - wp.x, pose.y - wp.y) > radius) break;
    state.waypointIndex += 1;
  }
}

function purePursuitTarget(pose: Pose, state: TrajectoryState, mutate = true): Vector2 {
  if (mutate) {
    advanceWaypoint(state, pose);
  }
  const goal = state.path[state.path.length - 1] ?? pose;
  if (state.path.length === 0) return goal;

  const { point: onPath, dist: offPath } = nearestPathPoint(state.path, pose);
  if (offPath > OFF_PATH_DIRECT_IN) {
    return goal;
  }

  let best = state.path[state.waypointIndex] ?? goal;
  for (let i = state.waypointIndex; i < state.path.length; i++) {
    const wp = state.path[i]!;
    const dist = Math.hypot(wp.x - pose.x, wp.y - pose.y);
    if (dist >= LOOKAHEAD_IN) {
      best = wp;
      break;
    }
    best = wp;
  }

  if (offPath > 6) {
    const blend = Math.min(1, (offPath - 6) / 16);
    return {
      x: best.x * (1 - blend) + onPath.x * blend,
      y: best.y * (1 - blend) + onPath.y * blend,
    };
  }

  return best;
}

/** Read-only pursuit / progress snapshot for nav debug overlays. */
export function getTrajectoryDebug(state: TrajectoryState, pose: Pose): TrajectoryDebug {
  if (state.path.length === 0) {
    return {
      waypointIndex: 0,
      pathLength: 0,
      pursuitTarget: null,
      pathGoal: null,
      distToGoal: 0,
      distToPursuit: 0,
      speedScale: 0,
      atEndpoint: true,
    };
  }

  const pathGoal = state.path[state.path.length - 1]!;
  const distToGoal = Math.hypot(pathGoal.x - pose.x, pathGoal.y - pose.y);
  const atEndpoint = distToGoal < GOAL_TOLERANCE_IN;
  const pursuitTarget = purePursuitTarget(pose, state, false);
  const distToPursuit = Math.hypot(pursuitTarget.x - pose.x, pursuitTarget.y - pose.y);
  const speedScale = Math.min(1, distToGoal / SLOW_RADIUS_IN);

  return {
    waypointIndex: state.waypointIndex,
    pathLength: state.path.length,
    pursuitTarget: { ...pursuitTarget },
    pathGoal: { ...pathGoal },
    distToGoal,
    distToPursuit,
    speedScale,
    atEndpoint,
  };
}

/**
 * Field-centric holonomic velocity command from path polyline.
 * forward = +Y field, strafe = +X field (matches human teleop default).
 */
export function trajectoryStep(
  state: TrajectoryState,
  pose: Pose,
  linear: Vector2,
  dt: number,
  limits: KinematicLimits,
  maxAccel: number,
): HolonomicInput {
  if (state.path.length === 0) {
    return { forward: 0, strafe: 0, turn: 0, brake: true };
  }

  const goal = state.path[state.path.length - 1]!;
  const distToGoal = Math.hypot(goal.x - pose.x, goal.y - pose.y);

  if (distToGoal < GOAL_TOLERANCE_IN) {
    if (state.finalHeading !== undefined) {
      const err = normalizeAngle(state.finalHeading - pose.heading);
      if (Math.abs(err) > 0.08) {
        return { forward: 0, strafe: 0, turn: Math.max(-1, Math.min(1, err * 3.5)) };
      }
    }
    return { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true };
  }

  const target = purePursuitTarget(pose, state);
  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const bearingDist = Math.hypot(dx, dy);
  if (bearingDist < 1e-3) {
    return { forward: 0, strafe: 0, turn: 0, brake: true };
  }

  const speedScale = Math.min(1, distToGoal / SLOW_RADIUS_IN);
  const maxSpeed = limits.maxVelocity * speedScale;
  const desiredVx = (dx / bearingDist) * maxSpeed;
  const desiredVy = (dy / bearingDist) * maxSpeed;

  const alpha = maxAccel <= 0 ? 1 : Math.min(1, (maxAccel * dt) / Math.max(maxSpeed, 1));
  const vx = linear.x + (desiredVx - linear.x) * alpha;
  const vy = linear.y + (desiredVy - linear.y) * alpha;

  const norm = Math.max(limits.maxVelocity, 1);
  return {
    forward: Math.max(-1, Math.min(1, vy / norm)),
    strafe: Math.max(-1, Math.min(1, vx / norm)),
    turn: 0,
  };
}

export function fieldRotateToward(
  pose: Pose,
  targetHeading: number,
  gain = 3.5,
): HolonomicInput {
  const err = normalizeAngle(targetHeading - pose.heading);
  if (Math.abs(err) <= 0.06) {
    return { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true };
  }
  return { forward: 0, strafe: 0, turn: Math.max(-1, Math.min(1, err * gain)), brake: true };
}

export function fieldStrafeToward(
  pose: Pose,
  target: Vector2,
  limits: KinematicLimits,
): HolonomicInput {
  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) {
    return { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true };
  }
  const norm = Math.max(limits.maxVelocity, 1);
  return {
    forward: Math.max(-1, Math.min(1, (dy / dist) * Math.min(0.7, dist / 18))),
    strafe: Math.max(-1, Math.min(1, (dx / dist) * Math.min(0.7, dist / 18))),
    turn: 0,
  };
}
