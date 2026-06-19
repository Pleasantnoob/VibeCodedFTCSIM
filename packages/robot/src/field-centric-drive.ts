import { INCHES_TO_METERS, type Pose } from '@ftc-sim/field';
import {
  clampHolonomicVelocityToField,
  sanitizeVelocityAtFieldEdge,
} from './kinematic.js';
import { normalizeHolonomic } from './holonomic.js';
import type { HolonomicInput, KinematicLimits, RobotFootprint } from './types.js';
import type { Vector2 } from './types.js';

export interface ForceTorque {
  fx: number;
  fy: number;
  torque: number;
}

export interface FieldCentricDriveParams {
  mass: number;
  input: HolonomicInput;
  bodyPose: Pose;
  bodyVelocity: Vector2;
  bodyAngular: number;
  limits: KinematicLimits;
  footprint: RobotFootprint;
  fieldSizeInches?: number;
  maxAcceleration?: number;
  maxAngularAcceleration?: number;
  coastDecel?: { linear: number; angular: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const DEFAULT_COAST = { linear: 28, angular: 8 };

/**
 * Velocity-tracking field-centric drive for Rapier (world-frame targets).
 * Uses one PD law for drive and coast: desired velocity goes to zero when input is released.
 */
export function computeFieldCentricDriveForces(params: FieldCentricDriveParams): ForceTorque {
  const normalized = normalizeHolonomic(params.input);
  const inputMagnitude =
    Math.abs(normalized.forward) + Math.abs(normalized.strafe) + Math.abs(normalized.turn);

  const maxAcceleration = params.maxAcceleration ?? 24;
  const maxAngularAcceleration = params.maxAngularAcceleration ?? 10;
  const coast = params.coastDecel ?? DEFAULT_COAST;
  const driveGain = 4;
  const fieldSize = params.fieldSizeInches;

  const rawDesiredVx = -normalized.strafe * params.limits.maxVelocity;
  const rawDesiredVy = normalized.forward * params.limits.maxVelocity;
  const { vx: desiredVx, vy: desiredVy } = clampHolonomicVelocityToField(
    params.bodyPose,
    params.footprint,
    rawDesiredVx,
    rawDesiredVy,
    fieldSize,
  );
  const desiredOmega = normalized.turn * params.limits.maxAngularVelocity;

  const { vx: edgeVx, vy: edgeVy } = sanitizeVelocityAtFieldEdge(
    params.bodyPose,
    params.footprint,
    params.bodyVelocity.x,
    params.bodyVelocity.y,
    fieldSize,
  );
  const omega = params.bodyAngular;

  const idle = inputMagnitude <= 0.03;
  const linearCap = idle ? coast.linear : maxAcceleration;
  const angularCap = idle ? coast.angular : maxAngularAcceleration;

  const ax = clamp(driveGain * (desiredVx - edgeVx), -linearCap, linearCap);
  const ay = clamp(driveGain * (desiredVy - edgeVy), -linearCap, linearCap);
  const alpha = clamp(driveGain * (desiredOmega - omega), -angularCap, angularCap);

  const fx = params.mass * ax * INCHES_TO_METERS;
  const fy = params.mass * ay * INCHES_TO_METERS;
  const trackWidthMeters = params.footprint.width * INCHES_TO_METERS;
  const inertia = (params.mass * trackWidthMeters * trackWidthMeters) / 6;
  const torque = inertia * alpha;

  return { fx, fy, torque };
}
