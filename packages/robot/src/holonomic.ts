import type { HolonomicInput } from './types.js';

export function deadzone(value: number, threshold = 0.15): number {
  return Math.abs(value) < threshold ? 0 : value;
}

export function normalizeHolonomic(input: HolonomicInput): HolonomicInput {
  const flags = { brake: input.brake, endpointBrake: input.endpointBrake };
  const mag = Math.hypot(input.forward, input.strafe);
  if (mag > 1) {
    return {
      ...flags,
      forward: input.forward / mag,
      strafe: input.strafe / mag,
      turn: clampUnit(input.turn),
    };
  }
  return {
    ...flags,
    forward: input.forward,
    strafe: input.strafe,
    turn: clampUnit(input.turn),
  };
}

export function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function isHolonomicActive(input: HolonomicInput): boolean {
  return input.forward !== 0 || input.strafe !== 0 || input.turn !== 0;
}
