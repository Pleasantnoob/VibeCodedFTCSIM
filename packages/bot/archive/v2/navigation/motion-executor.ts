import type { Pose, Vector2 } from '@ftc-sim/field';
import { normalizeAngle } from '@ftc-sim/field';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import {
  createTrajectoryState,
  fieldRotateToward,
  getTrajectoryDebug,
  pathWaypointsSignature,
  setTrajectoryPath,
  trajectoryStep,
  type TrajectoryDebug,
  type TrajectoryState,
} from './trajectory-generator.js';

export { pathWaypointsSignature };

export class MotionExecutor {
  private traj: TrajectoryState = createTrajectoryState();
  private activePathSignature = '';
  private goalPoint: Vector2 | null = null;
  private finalHeading: number | undefined;

  followPath(waypoints: Vector2[], finalHeading?: number): void {
    setTrajectoryPath(this.traj, waypoints, finalHeading);
    this.activePathSignature = pathWaypointsSignature(waypoints);
    this.goalPoint = waypoints[waypoints.length - 1] ?? null;
    this.finalHeading = finalHeading;
  }

  followPathIfChanged(waypoints: Vector2[], finalHeading?: number): boolean {
    const signature = pathWaypointsSignature(waypoints);
    if (signature === this.activePathSignature && this.traj.path.length > 0) {
      return false;
    }
    this.followPath(waypoints, finalHeading);
    return true;
  }

  clear(): void {
    this.traj = createTrajectoryState();
    this.activePathSignature = '';
    this.goalPoint = null;
    this.finalHeading = undefined;
  }

  update(
    pose: Pose,
    linear: Vector2,
    dt: number,
    limits: KinematicLimits,
    maxAccel = 48,
  ): HolonomicInput {
    if (this.traj.path.length === 0) {
      return { forward: 0, strafe: 0, turn: 0, brake: true };
    }
    return trajectoryStep(this.traj, pose, linear, dt, limits, maxAccel);
  }

  rotateToward(pose: Pose, targetHeading: number): HolonomicInput {
    return fieldRotateToward(pose, targetHeading);
  }

  isAtGoal(pose: Pose, goal: Vector2, toleranceIn = 5): boolean {
    return Math.hypot(pose.x - goal.x, pose.y - goal.y) <= toleranceIn;
  }

  isFollowingPath(): boolean {
    return this.traj.path.length > 0;
  }

  get goal(): Vector2 | null {
    return this.goalPoint;
  }

  get headingTarget(): number | undefined {
    return this.finalHeading;
  }

  get pathSignature(): string {
    return this.activePathSignature;
  }

  get waypointIndex(): number {
    return this.traj.waypointIndex;
  }

  get pathLength(): number {
    return this.traj.path.length;
  }

  getDebug(pose: Pose): TrajectoryDebug {
    return getTrajectoryDebug(this.traj, pose);
  }
}
