import { normalizeAngle } from '@ftc-sim/field';
import { robotInLaunchZone } from '@ftc-sim/mechanisms';
import type { BotObservation, BotTaskGoal } from '../types.js';
import { goalBasinForAlliance } from '../cognition/task-selector.js';

const ALIGN_TOLERANCE_RAD = 0.18;

export type ShotTier = 'close' | 'medium' | 'long';

export function headingTowardBasin(obs: BotObservation): number {
  const basin = goalBasinForAlliance(obs.self.alliance);
  return Math.atan2(basin.y - obs.self.pose.y, basin.x - obs.self.pose.x);
}

export function isAlignedForShot(obs: BotObservation): boolean {
  const basinHeading = headingTowardBasin(obs);
  return Math.abs(normalizeAngle(basinHeading - obs.self.pose.heading)) < ALIGN_TOLERANCE_RAD;
}

export function shotTier(obs: BotObservation): ShotTier {
  const basin = goalBasinForAlliance(obs.self.alliance);
  const dist = Math.hypot(basin.x - obs.self.pose.x, basin.y - obs.self.pose.y);
  if (dist < 30) return 'close';
  if (dist < 70) return 'medium';
  return 'long';
}

export function shootForTask(
  obs: BotObservation,
  task: BotTaskGoal,
  aimErrorRad: number,
): {
  shoot?: boolean;
  shootEdge?: boolean;
  shootHeld?: boolean;
  reposition?: boolean;
} {
  if (task.kind !== 'score' && task.kind !== 'auto_hold') return {};
  if (obs.self.stored.length === 0) return {};

  const inLaunch = robotInLaunchZone(obs.self.pose, obs.footprint, obs.field);
  const basinHeading = headingTowardBasin(obs) + aimErrorRad;
  const headingErr = Math.abs(normalizeAngle(basinHeading - obs.self.pose.heading));
  const aligned = headingErr < ALIGN_TOLERANCE_RAD;
  const tier = shotTier(obs);

  if (!inLaunch && tier === 'long') {
    return { reposition: true };
  }

  if (inLaunch && aligned) {
    return tier === 'close'
      ? { shootEdge: true, shoot: true }
      : { shootHeld: true, shoot: true };
  }

  if (task.kind === 'auto_hold' && inLaunch && aligned) {
    return { shootHeld: true, shoot: true, shootEdge: false };
  }

  return {};
}
