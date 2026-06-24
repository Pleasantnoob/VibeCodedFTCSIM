import { normalizeAngle, type Pose } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { HolonomicInput } from '@ftc-sim/robot';

const GOAL_BASIN: Record<Alliance, { x: number; y: number }> = {
  blue: { x: 10, y: 132 },
  red: { x: 134, y: 132 },
};

const HOMING_TURN_GAIN = 11;
const HOMING_ALIGNED_RAD = 0.035;

function goalHeading(pose: Pose, alliance: Alliance): number {
  const basin = GOAL_BASIN[alliance];
  return Math.atan2(basin.y - pose.y, basin.x - pose.x);
}

/** Blend goal-facing turn into live drive (hold RB / R1 while moving). */
export function applyGoalHoming(
  pose: Pose,
  alliance: Alliance,
  baseInput: HolonomicInput,
): HolonomicInput {
  const err = normalizeAngle(goalHeading(pose, alliance) - pose.heading);
  if (Math.abs(err) < HOMING_ALIGNED_RAD) {
    return { ...baseInput, turn: 0 };
  }
  const homingTurn = Math.max(-1, Math.min(1, err * HOMING_TURN_GAIN));
  return {
    forward: baseInput.forward,
    strafe: baseInput.strafe,
    turn: homingTurn,
    brake: baseInput.brake,
  };
}
