import { normalizeAngle, type Pose, type Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { HolonomicInput } from '@ftc-sim/robot';
import type { BotRobotSnapshot, BotTaskKind } from '../types.js';
import type { Difficulty } from '../types.js';
import { fieldDriveToward } from '../drive/field-drive.js';

const BLOCKER_DIST_IN = 44;
const CORRIDOR_HALF_WIDTH_IN = 22;

/** Lower robot id takes the high (+y) lane; the other passes underneath. */
export function parkPassVerticalSide(selfId: string, otherId: string): 1 | -1 {
  return selfId.localeCompare(otherId) <= 0 ? 1 : -1;
}

function isInCorridor(from: Pose, to: Vector2, point: Vector2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 4) return false;
  const t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / len2;
  if (t < 0.08 || t > 0.94) return false;
  const projX = from.x + t * dx;
  const projY = from.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY) < CORRIDOR_HALF_WIDTH_IN;
}

function isHeadOnParkBlocker(pose: Pose, target: Vector2, blocker: BotRobotSnapshot): boolean {
  const sep = Math.hypot(blocker.pose.x - pose.x, blocker.pose.y - pose.y);
  if (sep > 40 || sep < 6) return false;

  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 16) return false;

  const t = ((blocker.pose.x - pose.x) * dx + (blocker.pose.y - pose.y) * dy) / len2;
  const aheadOnRoute = t > 0.1 && t < 0.92;
  const inCorridor = isInCorridor(pose, target, blocker.pose);

  if (!aheadOnRoute && !inCorridor) return false;
  if (sep > 32 && !inCorridor) return false;

  const toTarget = Math.atan2(dy, dx);
  const blockerTowardSelf = Math.atan2(pose.y - blocker.pose.y, pose.x - blocker.pose.x);
  const facing =
    Math.abs(normalizeAngle(toTarget - blockerTowardSelf)) < 1.05 ||
    Math.abs(normalizeAngle(blocker.pose.heading - blockerTowardSelf)) < 1.1;

  return facing || (inCorridor && sep < 30);
}

/** Mid-field waypoint shifted over (+y) or under (-y) for a committed pass. */
export function parkPassDetourTarget(
  pose: Vector2,
  target: Vector2,
  blocker: BotRobotSnapshot,
  side: 1 | -1,
): Vector2 {
  const midX = (pose.x + blocker.pose.x + target.x) / 3;
  const passY = Math.max(34, Math.min(56, (pose.y + blocker.pose.y) * 0.5 + side * 14));
  return { x: midX, y: passY };
}

function findParkBlocker(
  pose: Pose,
  target: Vector2,
  robots: readonly BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  robotTasks?: ReadonlyMap<string, BotTaskKind>,
): BotRobotSnapshot | null {
  for (const other of robots) {
    if (other.id === selfId) continue;
    const dist = Math.hypot(other.pose.x - pose.x, other.pose.y - pose.y);
    if (dist > BLOCKER_DIST_IN) continue;

    const otherTask = robotTasks?.get(other.id);
    const inCorridor = isInCorridor(pose, target, other.pose);

    if (other.alliance === selfAlliance) {
      if (inCorridor || dist < 26) return other;
      continue;
    }

    const opponentParking = otherTask === 'park';
    const isPlayer = other.id === 'player';
    if (!opponentParking && !isPlayer) continue;
    if (!inCorridor && dist > 32) continue;
    if (isPlayer && dist > 38) continue;
    return other;
  }
  return null;
}

/** Ally closer to the same park target and blocking the lane — wait briefly, then force through. */
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
    if (otherDist >= selfDist - 4) continue;
    const separation = Math.hypot(other.pose.x - self.pose.x, other.pose.y - self.pose.y);
    if (separation > 48) continue;
    if (!isInCorridor(self.pose, target, other.pose) && separation > 26) continue;
    if (isHeadOnParkBlocker(self.pose, target, other)) return false;
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
    robotTasks?: ReadonlyMap<string, BotTaskKind>;
  },
): HolonomicInput {
  const base = fieldDriveToward(pose, target, opts);
  const blocker = findParkBlocker(
    pose,
    target,
    robots,
    selfId,
    selfAlliance,
    opts?.robotTasks,
  );
  if (!blocker) return base;

  const dx = target.x - pose.x;
  const dy = target.y - pose.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return base;

  const blockerParking = opts?.robotTasks?.get(blocker.id) === 'park';
  const isPlayer = blocker.id === 'player';
  const headOn = blockerParking && isHeadOnParkBlocker(pose, target, blocker);

  if (headOn) {
    const side = parkPassVerticalSide(selfId, blocker.id);
    const passTarget = parkPassDetourTarget(pose, target, blocker, side);
    const passDist = Math.hypot(passTarget.x - pose.x, passTarget.y - pose.y);
    if (passDist > 5) {
      const passInput = fieldDriveToward(pose, passTarget, {
        ...opts,
        maxSpeed: Math.min(0.82, opts?.maxSpeed ?? 0.85),
        arriveIn: 7,
      });
      return {
        forward: Math.max(0.48, passInput.forward ?? 0),
        strafe: passInput.strafe ?? 0,
        turn: passInput.turn ?? 0,
        brake: passInput.brake,
        endpointBrake: passInput.endpointBrake,
      };
    }
  }

  const cross = dx * (blocker.pose.y - pose.y) - dy * (blocker.pose.x - pose.x);
  let detour = cross >= 0 ? 0.75 : -0.75;
  const opponentPark = blocker.alliance !== selfAlliance && blockerParking;
  if (opponentPark || isPlayer) {
    detour *= 1.1;
  }
  const forwardScale = opponentPark ? 0.38 : isPlayer ? 0.48 : blocker.alliance === selfAlliance ? 0.52 : 0.58;

  return {
    forward: Math.max(-1, Math.min(1, (base.forward ?? 0) * forwardScale)),
    strafe: Math.max(-1, Math.min(1, (base.strafe ?? 0) + detour)),
    turn: base.turn ?? 0,
    brake: base.brake,
    endpointBrake: base.endpointBrake,
  };
}

/** Escape nudge when wedged during park — use assigned over/under pass when head-on. */
export function parkEscapeInput(
  pose: Pose,
  robots: readonly BotRobotSnapshot[],
  selfId: string,
  alliance: Alliance,
  nudge: number,
  driveTarget?: Vector2,
): HolonomicInput {
  let nearest: BotRobotSnapshot | null = null;
  let nearestDist = Infinity;
  for (const other of robots) {
    if (other.id === selfId) continue;
    const dist = Math.hypot(other.pose.x - pose.x, other.pose.y - pose.y);
    if (dist < nearestDist && dist < 42) {
      nearestDist = dist;
      nearest = other;
    }
  }

  const target = driveTarget ?? { x: pose.x, y: pose.y - 24 };

  if (nearest && nearestDist < 32 && isHeadOnParkBlocker(pose, target, nearest)) {
    const side = parkPassVerticalSide(selfId, nearest.id);
    const passTarget = parkPassDetourTarget(pose, target, nearest, side);
    const passInput = fieldDriveToward(pose, passTarget, { maxSpeed: 0.58, arriveIn: 5 });
    return {
      forward: Math.max(0.42, passInput.forward ?? 0),
      strafe: passInput.strafe ?? 0,
      turn: 0,
    };
  }

  if (!nearest) {
    const strafe = alliance === 'blue' ? (nudge % 2 === 0 ? 0.65 : -0.45) : nudge % 2 === 0 ? -0.65 : 0.45;
    return { forward: 0.42, strafe, turn: 0 };
  }

  const side = parkPassVerticalSide(selfId, nearest.id);
  const passTarget = parkPassDetourTarget(pose, target, nearest, side);
  const passInput = fieldDriveToward(pose, passTarget, { maxSpeed: 0.52, arriveIn: 5 });
  return {
    forward: Math.max(0.35, passInput.forward ?? 0),
    strafe: passInput.strafe ?? 0,
    turn: 0,
  };
}
