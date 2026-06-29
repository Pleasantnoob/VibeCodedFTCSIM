import { normalizeAngle, type Pose, type Vector2 } from '@ftc-sim/field';
import type { HolonomicInput } from '@ftc-sim/robot';
import type { Alliance } from '@ftc-sim/game-decode';
import type { Difficulty } from '../types.js';
import { distToGateCautionArea } from '../coordination.js';
import { gateTurnGainFor, scoreTurnGainFor, turnGainFor } from '../personality/difficulty.js';

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

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Brake mode in velocity-drive cuts angular accel ~55%; skip it for pure rotation. */
function scoreDriveFlags(
  input: Pick<HolonomicInput, 'forward' | 'strafe' | 'turn'>,
  opts?: { endpoint?: boolean },
): Pick<HolonomicInput, 'brake' | 'endpointBrake'> {
  const translating = Math.hypot(input.forward ?? 0, input.strafe ?? 0) > 0.06;
  const turning = Math.abs(input.turn ?? 0) > 0.08;
  if (turning && !translating) {
    return opts?.endpoint ? { endpointBrake: true } : {};
  }
  return opts?.endpoint ? { endpointBrake: true, brake: true } : { brake: true };
}

function resolveTurnGain(difficulty?: Difficulty, override?: number): number {
  return override ?? (difficulty ? turnGainFor(difficulty) : DEFAULT_TURN_GAIN);
}

/** Distance at which gate turn easing begins / reaches minimum (inches). */
export const GATE_CAUTION_BLEND_OUT_IN = 20;
export const GATE_CAUTION_BLEND_IN_IN = 10;

export function turnGainInGateCautionArea(
  pose: Vector2,
  alliance: Alliance,
  difficulty: Difficulty,
  openFieldGain: number = scoreTurnGainFor(difficulty),
): number {
  const dist = distToGateCautionArea(pose, alliance);
  const slow = gateTurnGainFor(difficulty);
  if (dist >= GATE_CAUTION_BLEND_OUT_IN) return openFieldGain;
  if (dist <= GATE_CAUTION_BLEND_IN_IN) return slow;
  const t = (dist - GATE_CAUTION_BLEND_IN_IN) / (GATE_CAUTION_BLEND_OUT_IN - GATE_CAUTION_BLEND_IN_IN);
  return slow + t * (openFieldGain - slow);
}

/** @deprecated use turnGainInGateCautionArea */
export function turnGainNearOpponentGate(
  pose: Vector2,
  alliance: Alliance,
  difficulty: Difficulty,
  openFieldGain?: number,
): number {
  return turnGainInGateCautionArea(pose, alliance, difficulty, openFieldGain);
}

/**
 * Cap commanded turn while translating through the tight corner — full drive speed,
 * less corner swing. Pure rotation (no translation) is uncapped.
 */
function softenTurnWhileMovingNearGate(turn: number, gateDist: number, translating: boolean): number {
  if (!translating || gateDist >= GATE_CAUTION_BLEND_IN_IN) return turn;
  const coreIn = 5;
  let cap = 1;
  if (gateDist <= coreIn) {
    cap = 0.55;
  } else {
    const t = (gateDist - coreIn) / (GATE_CAUTION_BLEND_IN_IN - coreIn);
    cap = 0.55 + t * 0.45;
  }
  return clampUnit(turn) * cap;
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
    alliance?: Alliance;
  },
): HolonomicInput {
  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  const arriveIn = opts?.arriveIn ?? ARRIVE_IN;
  const maxSpeed = opts?.maxSpeed ?? 0.75;
  const gateDist =
    opts?.alliance !== undefined ? distToGateCautionArea(pose, opts.alliance) : Infinity;
  const baseTurnGain = resolveTurnGain(opts?.difficulty, opts?.turnGain);
  const turnGain =
    opts?.alliance !== undefined && opts?.difficulty && gateDist < GATE_CAUTION_BLEND_OUT_IN
      ? turnGainInGateCautionArea(pose, opts.alliance, opts.difficulty, baseTurnGain)
      : baseTurnGain;

  if (dist < arriveIn) {
    if (opts?.faceHeading !== undefined) {
      const err = headingError(pose, opts.faceHeading);
      if (Math.abs(err) > INTAKE_ALIGN_RAD) {
        return { forward: 0, strafe: 0, turn: clampTurn(err, turnGain) };
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
    let turn = clampTurn(headingError(pose, opts.faceHeading), turnGain);
    const translating = speed > 0.06;
    turn = softenTurnWhileMovingNearGate(turn, gateDist, translating);
    input.turn = turn;
  }

  return input;
}

/** Field translate toward artifact; rotate intake (+X) toward it while moving. */
export function fieldDriveToCollect(
  pose: Pose,
  target: Vector2,
  difficulty: Difficulty = 'normal',
  alliance?: Alliance,
): HolonomicInput {
  const face = intakeFaceHeading(pose, target);
  const err = Math.abs(headingError(pose, face));
  return fieldDriveToward(pose, target, {
    faceHeading: face,
    maxSpeed: err > 0.45 ? 0.58 : 0.78,
    arriveIn: 3,
    difficulty,
    alliance,
  });
}

/** Full-rate rotate toward shoot heading; optional creep if position needs a nudge. */
export function fieldDriveAlignShoot(
  pose: Pose,
  faceHeading: number,
  difficulty: Difficulty = 'normal',
  nudgeTarget?: Vector2,
): HolonomicInput {
  const gain = scoreTurnGainFor(difficulty);
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
          ...scoreDriveFlags({ forward: ny * creep, strafe: -nx * creep, turn: 0 }),
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

  return { forward, strafe, turn, ...scoreDriveFlags({ forward, strafe, turn }) };
}

/** Drive toward launch at full speed; only turn rate eases near gate corners. */
export function fieldDriveScoreApproach(
  pose: Pose,
  target: Vector2,
  faceHeading: number,
  difficulty: Difficulty = 'normal',
  alliance?: Alliance,
): HolonomicInput {
  const gateDist = alliance !== undefined ? distToGateCautionArea(pose, alliance) : Infinity;
  const openGain = scoreTurnGainFor(difficulty);
  const inGateCaution = alliance !== undefined && gateDist < GATE_CAUTION_BLEND_OUT_IN;
  const gain =
    inGateCaution && alliance !== undefined
      ? turnGainInGateCautionArea(pose, alliance, difficulty, openGain)
      : openGain;
  const err = headingError(pose, faceHeading);
  const absErr = Math.abs(err);
  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  let turn = clampTurn(err, gain);

  if (dist < 2 && absErr < 0.1) {
    return { ...ZERO, brake: true, endpointBrake: true };
  }

  const nearShoot = dist < 12;
  const alignSlow = nearShoot && absErr < 0.18 ? Math.max(0.6, absErr / 0.18) : 1;
  const distSlow = dist < 8 ? Math.max(0.65, dist / 8) : 1;
  const speed = Math.min(0.78, dist / 12) * alignSlow * distSlow;
  const nx = dist > 0.01 ? dx / dist : 0;
  const ny = dist > 0.01 ? dy / dist : 0;
  const forward = ny * speed;
  const strafe = -nx * speed;
  const translating = speed > 0.08;
  turn = softenTurnWhileMovingNearGate(turn, gateDist, translating);
  const endpoint = dist < 3 && absErr < 0.14;
  const flags =
    nearShoot && (absErr < 0.12 || dist < 4)
      ? scoreDriveFlags({ forward, strafe, turn }, { endpoint })
      : {};

  return { forward, strafe, turn, ...flags };
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
