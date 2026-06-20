import type { Pose } from '@ftc-sim/field';
import type { RobotSnapshotEntry } from '@ftc-sim/net';

const MAX_EXTRAP_SEC = 0.1;

/** Advance a server pose by velocity for short gaps between snapshots (client-side). */
export function extrapolatePose(
  pose: Pose,
  linear: { x: number; y: number },
  angular: number,
  ageSec: number,
): Pose {
  const dt = Math.min(MAX_EXTRAP_SEC, Math.max(0, ageSec));
  if (dt <= 0) return pose;
  return {
    x: pose.x + linear.x * dt,
    y: pose.y + linear.y * dt,
    heading: pose.heading + angular * dt,
  };
}

export function extrapolateRobotSnapshot(robot: RobotSnapshotEntry, ageSec: number): Pose {
  return extrapolatePose(robot.pose, robot.linear, robot.angular, ageSec);
}
