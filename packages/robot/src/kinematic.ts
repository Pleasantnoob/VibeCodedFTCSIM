import { FIELD_SIZE_INCHES, normalizeAngle, type Pose, type Vector2 } from '@ftc-sim/field';
import type { DriveFrame, HolonomicInput, KinematicLimits, RobotFootprint } from './types.js';
import { normalizeHolonomic } from './holonomic.js';
import { resolveBarrierCollisions } from './barrier-collision.js';

export { resolveBarrierCollisions } from './barrier-collision.js';

const FIELD_BOUND_EPS = 0.001;

/** Robot frame: +X forward, +Y left. */
export function robotCorners(pose: Pose, footprint: RobotFootprint): Vector2[] {
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

export function holonomicToWorldVelocity(
  input: HolonomicInput,
  heading: number,
  limits: KinematicLimits,
  driveFrame: DriveFrame = 'field',
): { vx: number; vy: number; omega: number } {
  const n = normalizeHolonomic(input);
  const forward = n.forward * limits.maxVelocity;
  const strafe = n.strafe * limits.maxVelocity;

  if (driveFrame === 'field') {
    return {
      vx: -strafe,
      vy: forward,
      omega: n.turn * limits.maxAngularVelocity,
    };
  }

  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    vx: forward * cos - strafe * sin,
    vy: forward * sin + strafe * cos,
    omega: n.turn * limits.maxAngularVelocity,
  };
}

export function stepKinematicPose(
  pose: Pose,
  input: HolonomicInput,
  dt: number,
  limits: KinematicLimits,
  driveFrame: DriveFrame = 'field',
): Pose {
  const { vx, vy, omega } = holonomicToWorldVelocity(input, pose.heading, limits, driveFrame);
  return {
    x: pose.x + vx * dt,
    y: pose.y + vy * dt,
    heading: normalizeAngle(pose.heading + omega * dt),
  };
}


/** Keep holonomic target velocity from pushing the robot OBB outside the field. */
export function clampHolonomicVelocityToField(
  pose: Pose,
  footprint: RobotFootprint,
  desiredVx: number,
  desiredVy: number,
  fieldSizeInches = FIELD_SIZE_INCHES,
  margin = 0.5,
): { vx: number; vy: number } {
  const corners = robotCorners(pose, footprint);
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxY = Math.max(...corners.map((corner) => corner.y));

  let vx = desiredVx;
  let vy = desiredVy;

  const softenOutbound = (clearance: number, speed: number, outbound: boolean): number => {
    if (!outbound) return speed;
    if (clearance <= margin) return 0;
    if (clearance >= margin * 2) return speed;
    return speed * ((clearance - margin) / margin);
  };

  vx = softenOutbound(minX, vx, vx < 0);
  vx = softenOutbound(fieldSizeInches - maxX, vx, vx > 0);
  vy = softenOutbound(minY, vy, vy < 0);
  vy = softenOutbound(fieldSizeInches - maxY, vy, vy > 0);

  return { vx, vy };
}

/** Zero velocity components that push further outside the field (after contact solver jitter). */
export function sanitizeVelocityAtFieldEdge(
  pose: Pose,
  footprint: RobotFootprint,
  vx: number,
  vy: number,
  fieldSizeInches = FIELD_SIZE_INCHES,
  margin = 0.5,
): { vx: number; vy: number } {
  const corners = robotCorners(pose, footprint);
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxY = Math.max(...corners.map((corner) => corner.y));

  let sx = vx;
  let sy = vy;

  if (minX <= margin && sx < 0) sx = 0;
  if (maxX >= fieldSizeInches - margin && sx > 0) sx = 0;
  if (minY <= margin && sy < 0) sy = 0;
  if (maxY >= fieldSizeInches - margin && sy > 0) sy = 0;

  return { vx: sx, vy: sy };
}

export function clampPoseToField(pose: Pose, footprint: RobotFootprint): Pose {
  let next = { ...pose };
  for (let pass = 0; pass < 10; pass++) {
    const corners = robotCorners(next, footprint);
    const minX = Math.min(...corners.map((corner) => corner.x));
    const maxX = Math.max(...corners.map((corner) => corner.x));
    const minY = Math.min(...corners.map((corner) => corner.y));
    const maxY = Math.max(...corners.map((corner) => corner.y));

    let dx = 0;
    let dy = 0;
    if (minX < FIELD_BOUND_EPS) dx = FIELD_BOUND_EPS - minX;
    if (maxX > FIELD_SIZE_INCHES - FIELD_BOUND_EPS) dx = FIELD_SIZE_INCHES - FIELD_BOUND_EPS - maxX;
    if (minY < FIELD_BOUND_EPS) dy = FIELD_BOUND_EPS - minY;
    if (maxY > FIELD_SIZE_INCHES - FIELD_BOUND_EPS) dy = FIELD_SIZE_INCHES - FIELD_BOUND_EPS - maxY;
    if (dx === 0 && dy === 0) break;
    next = { ...next, x: next.x + dx, y: next.y + dy };
  }
  return next;
}

export function integrateKinematicRobot(
  pose: Pose,
  input: HolonomicInput,
  dt: number,
  limits: KinematicLimits,
  barriers: Vector2[][],
  footprint: RobotFootprint,
  driveFrame: DriveFrame = 'field',
): Pose {
  const moved = stepKinematicPose(pose, input, dt, limits, driveFrame);
  const resolved = resolveBarrierCollisions(moved, barriers, footprint);
  return clampPoseToField(resolved, footprint);
}
