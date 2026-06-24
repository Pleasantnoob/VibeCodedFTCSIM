import { normalizeAngle, type Pose, type Vector2 } from '@ftc-sim/field';
import type { HolonomicInput } from '@ftc-sim/robot';
import type { Difficulty } from '../types.js';
import { turnGainFor } from '../personality/difficulty.js';

const ZERO: HolonomicInput = { forward: 0, strafe: 0, turn: 0 };

export const INTAKE_ALIGN_RAD = 0.15;
const ARRIVE_IN = 2.5;
const DEFAULT_TURN_GAIN = 3.5;

export function headingToTarget(pose: Pose, target: Vector2): number {
  return Math.atan2(target.y - pose.y, target.x - pose.x);
}

export function headingError(pose: Pose, faceHeading: number): number {
  return normalizeAngle(faceHeading - pose.heading);
}

/** Robot +X (intake) should point at this field bearing. */
export function intakeFaceHeading(pose: Pose, target: Vector2): number {
  return headingToTarget(pose, target);
}

export function intakeHeadingError(pose: Pose, target: Vector2): number {
  return headingError(pose, intakeFaceHeading(pose, target));
}

function clampTurn(err: number, gain: number): number {
  return Math.max(-1, Math.min(1, err * gain));
}

function resolveTurnGain(difficulty?: Difficulty, override?: number): number {
  return override ?? (difficulty ? turnGainFor(difficulty) : DEFAULT_TURN_GAIN);
}

/**
 * Field-centric holonomic drive: translate in any direction on the field.
 * Field frame: forward = +Y, strafe = -X (matches @ftc-sim/robot kinematics).
 */
export function fieldDriveToward(
  pose: Pose,
  target: Vector2,
  opts?: {
    faceHeading?: number;
    arriveIn?: number;
    maxSpeed?: number;
    turnGain?: number;
    difficulty?: Difficulty;
  },
): HolonomicInput {
  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  const arriveIn = opts?.arriveIn ?? ARRIVE_IN;
  const maxSpeed = opts?.maxSpeed ?? 0.75;
  const turnGain = resolveTurnGain(opts?.difficulty, opts?.turnGain);

  if (dist < arriveIn) {
    if (opts?.faceHeading !== undefined) {
      const err = headingError(pose, opts.faceHeading);
      if (Math.abs(err) > INTAKE_ALIGN_RAD) {
        return { forward: 0, strafe: 0, turn: clampTurn(err, turnGain), brake: true };
      }
    }
    return { ...ZERO, brake: true, endpointBrake: true };
  }

  const speed = Math.min(maxSpeed, dist / 16);
  const nx = dx / dist;
  const ny = dy / dist;

  const input: HolonomicInput = {
    forward: ny * speed,
    strafe: -nx * speed,
    turn: 0,
  };

  if (opts?.faceHeading !== undefined) {
    input.turn = clampTurn(headingError(pose, opts.faceHeading), turnGain);
  }

  return input;
}

/** Field translate toward artifact; rotate intake (+X) toward it while moving. */
export function fieldDriveToCollect(
  pose: Pose,
  target: Vector2,
  difficulty: Difficulty = 'normal',
): HolonomicInput {
  const face = intakeFaceHeading(pose, target);
  const err = Math.abs(headingError(pose, face));
  return fieldDriveToward(pose, target, {
    faceHeading: face,
    maxSpeed: err > 0.45 ? 0.5 : 0.7,
    arriveIn: 3,
    difficulty,
  });
}

/** Full-rate rotate toward shoot heading; optional creep if position needs a nudge. */
export function fieldDriveAlignShoot(
  pose: Pose,
  faceHeading: number,
  difficulty: Difficulty = 'normal',
  nudgeTarget?: Vector2,
): HolonomicInput {
  const gain = turnGainFor(difficulty);
  const err = headingError(pose, faceHeading);
  if (Math.abs(err) < 0.05) {
    if (nudgeTarget) {
      const dist = Math.hypot(nudgeTarget.x - pose.x, nudgeTarget.y - pose.y);
      if (dist > 1.2) {
        const creep = Math.min(0.22, dist / 20);
        const nx = (nudgeTarget.x - pose.x) / dist;
        const ny = (nudgeTarget.y - pose.y) / dist;
        return {
          forward: ny * creep,
          strafe: -nx * creep,
          turn: 0,
          brake: true,
        };
      }
    }
    return { ...ZERO, brake: true };
  }

  const turn = clampTurn(err, gain);
  let forward = 0;
  let strafe = 0;
  if (nudgeTarget && Math.abs(err) < 0.25) {
    const dist = Math.hypot(nudgeTarget.x - pose.x, nudgeTarget.y - pose.y);
    if (dist > 1.5) {
      const creep = Math.min(0.18, (dist / 18) * (Math.abs(err) / 0.25));
      const nx = (nudgeTarget.x - pose.x) / dist;
      const ny = (nudgeTarget.y - pose.y) / dist;
      forward = ny * creep;
      strafe = -nx * creep;
    }
  }

  return { forward, strafe, turn, brake: true };
}

/** Drive toward launch while rotating; slow early to avoid overshooting the goal line. */
export function fieldDriveScoreApproach(
  pose: Pose,
  target: Vector2,
  faceHeading: number,
  difficulty: Difficulty = 'normal',
): HolonomicInput {
  const gain = turnGainFor(difficulty);
  const err = headingError(pose, faceHeading);
  const absErr = Math.abs(err);
  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  const turn = clampTurn(err, gain);

  if (dist < 2 && absErr < 0.1) {
    return { ...ZERO, brake: true, endpointBrake: true };
  }

  const nearShoot = dist < 12;
  const alignSlow = nearShoot && absErr < 0.25 ? Math.max(0.3, absErr / 0.25) : 1;
  const distSlow = dist < 18 ? Math.max(0.35, dist / 18) : 1;
  const misalignSlow = absErr > 0.15 ? Math.max(0.25, 1 - absErr * 2.5) : 1;
  const speed = Math.min(0.62, dist / 20) * alignSlow * distSlow * misalignSlow;
  const nx = dist > 0.01 ? dx / dist : 0;
  const ny = dist > 0.01 ? dy / dist : 0;

  return {
    forward: ny * speed,
    strafe: -nx * speed,
    turn,
    brake: nearShoot && (absErr < 0.12 || dist < 4),
    endpointBrake: dist < 3 && absErr < 0.14,
  };
}

export function zeroDrive(): HolonomicInput {
  return { ...ZERO };
}

export function isDrivingCommand(input: HolonomicInput): boolean {
  return Math.hypot(input.forward ?? 0, input.strafe ?? 0) > 0.08;
}

export function isTurningCommand(input: HolonomicInput): boolean {
  return Math.abs(input.turn ?? 0) > 0.12;
}
