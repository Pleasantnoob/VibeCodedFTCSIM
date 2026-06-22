import type { Pose, Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { HolonomicInput } from '@ftc-sim/robot';
import type { BotRobotSnapshot, BotTaskKind } from '../types.js';
import type { Difficulty } from '../types.js';
import { fieldDriveToward } from '../drive/field-drive.js';

const BLOCKER_DIST_IN = 38;
const CORRIDOR_HALF_WIDTH_IN = 20;

function isInCorridor(from: Pose, to: Vector2, point: Vector2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 4) return false;
  const t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / len2;
  if (t < 0.1 || t > 0.92) return false;
  const projX = from.x + t * dx;
  const projY = from.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY) < CORRIDOR_HALF_WIDTH_IN;
}

function findParkBlocker(
  pose: Pose,
  target: Vector2,
  robots: readonly BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
): BotRobotSnapshot | null {
  for (const other of robots) {
    if (other.id === selfId) continue;
    const dist = Math.hypot(other.pose.x - pose.x, other.pose.y - pose.y);
    if (dist > BLOCKER_DIST_IN) continue;
    if (!isInCorridor(pose, target, other.pose)) continue;
    if (other.alliance === selfAlliance) return other;
    if (dist < 30) return other;
  }
  return null;
}

/** Ally closer to the same park target — wait so they clear the lane first. */
export function allyBlocksParkApproach(
  self: BotRobotSnapshot,
  target: Vector2,
  robots: readonly BotRobotSnapshot[],
  allyTasks: ReadonlyMap<string, BotTaskKind> | undefined,
): boolean {
  if (!allyTasks) return false;
  const selfDist = Math.hypot(target.x - self.pose.x, target.y - self.pose.y);
  for (const other of robots) {
    if (other.id === self.id || other.alliance !== self.alliance) continue;
    if (allyTasks.get(other.id) !== 'park') continue;
    const otherDist = Math.hypot(target.x - other.pose.x, target.y - other.pose.y);
    if (otherDist >= selfDist - 5) continue;
    if (Math.hypot(other.pose.x - self.pose.x, other.pose.y - self.pose.y) > 42) continue;
    return true;
  }
  return false;
}

/** Field drive toward base with a lateral detour when a robot blocks the corridor. */
export function fieldDriveTowardPark(
  pose: Pose,
  target: Vector2,
  robots: readonly BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  opts?: {
    faceHeading?: number;
    arriveIn?: number;
    maxSpeed?: number;
    difficulty?: Difficulty;
  },
): HolonomicInput {
  const base = fieldDriveToward(pose, target, opts);
  const blocker = findParkBlocker(pose, target, robots, selfId, selfAlliance);
  if (!blocker) return base;

  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return base;

  const cross = dx * (blocker.pose.y - pose.y) - dy * (blocker.pose.x - pose.x);
  const detour = cross >= 0 ? 0.5 : -0.5;
  const forwardScale = blocker.alliance === selfAlliance ? 0.55 : 0.65;

  return {
    forward: Math.max(-1, Math.min(1, (base.forward ?? 0) * forwardScale)),
    strafe: Math.max(-1, Math.min(1, (base.strafe ?? 0) + detour)),
    turn: base.turn ?? 0,
    brake: base.brake,
    endpointBrake: base.endpointBrake,
  };
}
