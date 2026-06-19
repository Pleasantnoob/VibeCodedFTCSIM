import type { Pose } from '@ftc-sim/field';

/** Frame-rate-independent exponential smoothing (time constant ~35 ms). */
export function smoothAlpha(dtSec: number, responseHz = 28): number {
  return 1 - Math.exp(-responseHz * dtSec);
}

const SNAP_DISTANCE_IN = 18;

export function shouldSnapPose(current: Pose, target: Pose): boolean {
  return Math.hypot(target.x - current.x, target.y - current.y) > SNAP_DISTANCE_IN;
}

export function shouldSnapPoint(
  current: { x: number; y: number },
  target: { x: number; y: number },
): boolean {
  return Math.hypot(target.x - current.x, target.y - current.y) > SNAP_DISTANCE_IN;
}

export function smoothPose(current: Pose, target: Pose, alpha: number): Pose {
  let dh = target.heading - current.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  return {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
    heading: current.heading + dh * alpha,
  };
}

export function smoothScalar(current: number, target: number, alpha: number): number {
  return current + (target - current) * alpha;
}
