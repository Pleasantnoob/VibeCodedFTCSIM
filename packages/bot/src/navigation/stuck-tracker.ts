import type { Pose, Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { HolonomicInput } from '@ftc-sim/robot';
import { isDrivingCommand, isTurningCommand } from '../drive/field-drive.js';

const STUCK_SEC = 1.0;
const MOVED_IN = 1.5;
const MIN_SPEED_IN_S = 5;

export interface StuckTracker {
  trackPose: Vector2 | null;
  stuckSinceSec: number | null;
  blockedArtifactIds: Set<string>;
  launchZone: 'near' | 'far' | null;
}

export function createStuckTracker(): StuckTracker {
  return {
    trackPose: null,
    stuckSinceSec: null,
    blockedArtifactIds: new Set(),
    launchZone: null,
  };
}

export function resetStuckTracker(tracker: StuckTracker): void {
  tracker.trackPose = null;
  tracker.stuckSinceSec = null;
  tracker.blockedArtifactIds.clear();
  tracker.launchZone = null;
}

/**
 * Returns true when stuck >1s while driving — caller should retarget.
 * `stuckArtifactId` / `stuckLaunch` identify what to block/flip.
 */
export function updateStuckTracker(
  tracker: StuckTracker,
  pose: Pose,
  linear: Vector2,
  input: HolonomicInput,
  elapsedSec: number,
  opts: {
    artifactId?: string;
    launchZone?: 'near' | 'far';
    allowTurnOnly?: boolean;
  } = {},
): boolean {
  const speed = Math.hypot(linear.x, linear.y);
  const moved =
    tracker.trackPose === null
      ? MOVED_IN + 1
      : Math.hypot(pose.x - tracker.trackPose.x, pose.y - tracker.trackPose.y);

  if (moved >= MOVED_IN || speed >= MIN_SPEED_IN_S) {
    tracker.stuckSinceSec = null;
    tracker.trackPose = { x: pose.x, y: pose.y };
    return false;
  }

  const trying =
    isDrivingCommand(input) || (opts.allowTurnOnly && isTurningCommand(input));
  if (!trying) {
    tracker.stuckSinceSec = null;
    return false;
  }

  if (tracker.stuckSinceSec === null) {
    tracker.stuckSinceSec = elapsedSec;
    if (tracker.trackPose === null) {
      tracker.trackPose = { x: pose.x, y: pose.y };
    }
    return false;
  }

  if (elapsedSec - tracker.stuckSinceSec < STUCK_SEC) {
    return false;
  }

  tracker.stuckSinceSec = null;
  tracker.trackPose = { x: pose.x, y: pose.y };

  if (opts.artifactId) {
    tracker.blockedArtifactIds.add(opts.artifactId);
  }
  if (opts.launchZone) {
    tracker.launchZone = opts.launchZone === 'near' ? 'far' : 'near';
  }

  return true;
}
