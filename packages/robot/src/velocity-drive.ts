import { normalizeAngle, type Pose, type Vector2 } from '@ftc-sim/field';
import {
  clampHolonomicVelocityToField,
  clampPoseToField,
  sanitizeVelocityAtFieldEdge,
} from './kinematic.js';
import {
  clampHolonomicVelocityToBarriers,
  resolveBarrierPhysics,
  resolveRobotObstacleCollisions,
} from './barrier-collision.js';
import { normalizeHolonomic } from './holonomic.js';
import type { DriveFrame, HolonomicInput, KinematicLimits, RobotFootprint } from './types.js';

export interface RobotMotionState {
  pose: Pose;
  linear: Vector2;
  angular: number;
}

export interface VelocityDriveParams {
  pose: Pose;
  linear: Vector2;
  angular: number;
  input: HolonomicInput;
  dt: number;
  limits: KinematicLimits;
  footprint: RobotFootprint;
  barriers: Vector2[][];
  robotObstacles?: Vector2[][];
  fieldSizeInches?: number;
  driveFrame?: DriveFrame;
  maxAcceleration?: number;
  maxAngularAcceleration?: number;
  coastDecel?: { linear: number; angular: number };
  brakeDecel?: { linear: number; angular: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const DEFAULT_BRAKE = { linear: 90, angular: 24 };
const BRAKE_HOLD = { linear: 120, angular: 32 };
const ENDPOINT_BRAKE = { linear: 165, angular: 42 };
const BRAKE_GAIN = 7;

function opposeMotion(velocity: number, cap: number): number {
  if (Math.abs(velocity) < 1e-4) return 0;
  return -Math.sign(velocity) * Math.min(cap, Math.abs(velocity) * BRAKE_GAIN);
}

function desiredWorldVelocity(
  input: HolonomicInput,
  heading: number,
  limits: KinematicLimits,
  driveFrame: DriveFrame,
): { vx: number; vy: number; omega: number } {
  const n = normalizeHolonomic(input);
  const forward = n.forward * limits.maxVelocity;
  const strafe = n.strafe * limits.maxVelocity;
  const omega = n.turn * limits.maxAngularVelocity;

  if (driveFrame === 'field') {
    return { vx: -strafe, vy: forward, omega };
  }

  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    vx: forward * cos - strafe * sin,
    vy: forward * sin + strafe * cos,
    omega,
  };
}

/** Stable holonomic teleop: PD in velocity space, then pose integration + barrier clamp. */
export function stepVelocityDrive(params: VelocityDriveParams): RobotMotionState {
  const driveFrame = params.driveFrame ?? 'field';
  const normalized = normalizeHolonomic(params.input);
  const inputMagnitude =
    Math.abs(normalized.forward) + Math.abs(normalized.strafe) + Math.abs(normalized.turn);

  const maxAcceleration = params.maxAcceleration ?? 48;
  const maxAngularAcceleration = params.maxAngularAcceleration ?? 18;
  const brakeDecel = params.brakeDecel ?? DEFAULT_BRAKE;
  const driveGain = 6;
  const fieldSize = params.fieldSizeInches;
  const dt = params.dt;
  const braking = params.input.brake === true || params.input.endpointBrake === true;
  const decel = params.input.endpointBrake
    ? ENDPOINT_BRAKE
    : braking
      ? BRAKE_HOLD
      : brakeDecel;

  const rawDesired = desiredWorldVelocity(params.input, params.pose.heading, params.limits, driveFrame);
  const { vx: fieldDesiredVx, vy: fieldDesiredVy } = clampHolonomicVelocityToField(
    params.pose,
    params.footprint,
    rawDesired.vx,
    rawDesired.vy,
    fieldSize,
  );
  const desiredLinearForConstraints = { x: fieldDesiredVx, y: fieldDesiredVy };

  const barrierClamped = clampHolonomicVelocityToBarriers(
    params.pose,
    params.footprint,
    rawDesired.vx,
    rawDesired.vy,
    params.barriers,
  );
  const { vx: desiredVx, vy: desiredVy } = clampHolonomicVelocityToField(
    params.pose,
    params.footprint,
    barrierClamped.vx,
    barrierClamped.vy,
    fieldSize,
  );
  const desiredOmega = rawDesired.omega;

  const { vx: edgeVx, vy: edgeVy } = sanitizeVelocityAtFieldEdge(
    params.pose,
    params.footprint,
    params.linear.x,
    params.linear.y,
    fieldSize,
  );
  const omega = params.angular;

  const idle = inputMagnitude <= 0.03 && !braking;

  let ax: number;
  let ay: number;
  let alpha: number;

  if (idle || braking) {
    ax = opposeMotion(edgeVx, decel.linear);
    ay = opposeMotion(edgeVy, decel.linear);
    alpha = opposeMotion(omega, decel.angular);

    if (!idle && braking) {
      const linearCap = maxAcceleration * 0.45;
      const angularCap = maxAngularAcceleration * 0.45;
      ax += clamp(driveGain * (desiredVx - edgeVx), -linearCap, linearCap);
      ay += clamp(driveGain * (desiredVy - edgeVy), -linearCap, linearCap);
      alpha += clamp(driveGain * (desiredOmega - omega), -angularCap, angularCap);
    }
  } else {
    const linearCap = maxAcceleration;
    const angularCap = maxAngularAcceleration;
    ax = clamp(driveGain * (desiredVx - edgeVx), -linearCap, linearCap);
    ay = clamp(driveGain * (desiredVy - edgeVy), -linearCap, linearCap);
    alpha = clamp(driveGain * (desiredOmega - omega), -angularCap, angularCap);

    if (Math.sign(desiredVx) !== 0 && Math.sign(edgeVx) !== 0 && Math.sign(desiredVx) !== Math.sign(edgeVx)) {
      ax += opposeMotion(edgeVx, decel.linear * 0.5);
    }
    if (Math.sign(desiredVy) !== 0 && Math.sign(edgeVy) !== 0 && Math.sign(desiredVy) !== Math.sign(edgeVy)) {
      ay += opposeMotion(edgeVy, decel.linear * 0.5);
    }
    if (Math.sign(desiredOmega) !== 0 && Math.sign(omega) !== 0 && Math.sign(desiredOmega) !== Math.sign(omega)) {
      alpha += opposeMotion(omega, decel.angular * 0.5);
    }
  }

  let nextVx = edgeVx + ax * dt;
  let nextVy = edgeVy + ay * dt;
  let nextOmega = omega + alpha * dt;

  const maxSpeed = params.limits.maxVelocity * 1.05;
  const speed = Math.hypot(nextVx, nextVy);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    nextVx *= scale;
    nextVy *= scale;
  }

  const maxOmega = params.limits.maxAngularVelocity * 1.05;
  nextOmega = clamp(nextOmega, -maxOmega, maxOmega);

  if ((idle || braking) && Math.hypot(nextVx, nextVy) < 0.05) {
    nextVx = 0;
    nextVy = 0;
  }
  if ((idle || braking) && Math.abs(nextOmega) < 0.02) {
    nextOmega = 0;
  }

  const barrierResult = resolveBarrierPhysics(
    params.pose,
    { x: nextVx, y: nextVy },
    nextOmega,
    params.barriers,
    params.footprint,
    dt,
    desiredLinearForConstraints,
    desiredOmega,
  );
  let nextPose = clampPoseToField(barrierResult.pose, params.footprint);
  nextVx = barrierResult.linear.x;
  nextVy = barrierResult.linear.y;
  nextOmega = barrierResult.angular;

  const sanitized = sanitizeVelocityAtFieldEdge(
    nextPose,
    params.footprint,
    nextVx,
    nextVy,
    fieldSize,
  );
  nextVx = sanitized.vx;
  nextVy = sanitized.vy;

  if (params.robotObstacles?.length) {
    nextPose = resolveRobotObstacleCollisions(nextPose, params.footprint, params.robotObstacles);
  }

  return {
    pose: nextPose,
    linear: { x: nextVx, y: nextVy },
    angular: nextOmega,
  };
}

export function barriersFromPolygons(barriers: Vector2[][]): Vector2[][] {
  return barriers;
}
