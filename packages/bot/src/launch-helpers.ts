import { normalizeAngle, type FieldDefinition, type Pose, type Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import { robotInGateZone, robotInLaunchZone } from '@ftc-sim/mechanisms';
import type { RobotFootprint } from '@ftc-sim/robot';

export const GOAL_BASIN: Record<Alliance, Vector2> = {
  blue: { x: 10, y: 132 },
  red: { x: 134, y: 132 },
};

const SHOOT_WAYPOINTS: Record<Alliance, { near: Vector2; far: Vector2 }> = {
  blue: { near: { x: 40, y: 115 }, far: { x: 68, y: 10 } },
  red: { near: { x: 104, y: 115 }, far: { x: 76, y: 10 } },
};

const LAUNCH_CENTROIDS = {
  near: { x: 72, y: 120 },
  far: { x: 72, y: 8 },
};

export function shootAlignTolerance(pose: Pose, alliance: Alliance): number {
  const tier = shotTier(pose, alliance);
  if (tier === 'long') return 0.1;
  if (tier === 'medium') return 0.16;
  return 0.2;
}

export function shootHeadingForAlliance(pose: Pose, alliance: Alliance): number {
  const basin = GOAL_BASIN[alliance];
  return Math.atan2(basin.y - pose.y, basin.x - pose.x);
}

export function shootHeadingError(pose: Pose, alliance: Alliance): number {
  return normalizeAngle(shootHeadingForAlliance(pose, alliance) - pose.heading);
}

export function launchApproach(
  pose: Pose,
  alliance: Alliance,
  preferZone: 'near' | 'far' | null = null,
): { target: Vector2; zone: 'near' | 'far' } {
  if (preferZone) {
    return { target: SHOOT_WAYPOINTS[alliance][preferZone], zone: preferZone };
  }
  const distNear = Math.hypot(
    pose.x - LAUNCH_CENTROIDS.near.x,
    pose.y - LAUNCH_CENTROIDS.near.y,
  );
  const distFar = Math.hypot(
    pose.x - LAUNCH_CENTROIDS.far.x,
    pose.y - LAUNCH_CENTROIDS.far.y,
  );
  const zone = distNear <= distFar ? 'near' : 'far';
  return { target: SHOOT_WAYPOINTS[alliance][zone], zone };
}

/** @deprecated use launchApproach */
export function nearestLaunchApproach(
  pose: Pose,
  alliance: Alliance,
): { target: Vector2; zone: 'near' | 'far' } {
  return launchApproach(pose, alliance, null);
}

export function checkInLaunchZone(
  pose: Pose,
  footprint: RobotFootprint,
  field: FieldDefinition,
): boolean {
  return robotInLaunchZone(pose, footprint, field);
}

export function checkInGateZone(
  pose: Pose,
  footprint: RobotFootprint,
  field: FieldDefinition,
  alliance: Alliance,
): boolean {
  const zone = field.zones.find((z) => z.type === 'gate_zone' && z.alliance === alliance);
  if (!zone) return false;
  return robotInGateZone(pose, footprint, zone.polygon);
}

export function shotTier(pose: Pose, alliance: Alliance): 'close' | 'medium' | 'long' {
  const basin = GOAL_BASIN[alliance];
  const dist = Math.hypot(basin.x - pose.x, basin.y - pose.y);
  if (dist < 30) return 'close';
  if (dist < 70) return 'medium';
  return 'long';
}

export function shootMechanismForPose(
  pose: Pose,
  alliance: Alliance,
  inLaunch: boolean,
): {
  command: { shoot?: boolean };
  shootEdge: boolean;
  shootHeld: boolean;
} {
  if (!inLaunch) {
    return { command: {}, shootEdge: false, shootHeld: false };
  }
  const tol = shootAlignTolerance(pose, alliance);
  const aligned = Math.abs(shootHeadingError(pose, alliance)) < tol;
  if (!aligned) {
    return { command: {}, shootEdge: false, shootHeld: false };
  }
  const tier = shotTier(pose, alliance);
  if (tier === 'close') {
    return { command: { shoot: true }, shootEdge: true, shootHeld: false };
  }
  return { command: { shoot: true }, shootEdge: false, shootHeld: true };
}
