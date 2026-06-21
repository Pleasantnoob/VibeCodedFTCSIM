import type { Pose, Vector2 } from '@ftc-sim/field';
import { normalizeAngle } from '@ftc-sim/field';
import { robotInLaunchZone } from '@ftc-sim/mechanisms';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import type { BotObservation, BotTaskGoal } from '../types.js';
import { launchApproachForRobot } from '../cognition/task-selector.js';
import { MotionExecutor } from './motion-executor.js';
import { fieldRotateToward, fieldStrafeToward } from './trajectory-generator.js';

const DIRECT_DRIVE_RADIUS_IN = 24;
const TASK_ARRIVE_IN = 3;
const OFF_PATH_IN = 18;

function nearestPathDist(path: Vector2[], pose: Pose): number {
  if (path.length === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lenSq = abX * abX + abY * abY;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((pose.x - a.x) * abX + (pose.y - a.y) * abY) / lenSq));
    const px = a.x + abX * t;
    const py = a.y + abY * t;
    best = Math.min(best, Math.hypot(px - pose.x, py - pose.y));
  }
  return best;
}

export function resolveDriveTarget(obs: BotObservation, task: BotTaskGoal, robotId: string): Vector2 {
  if (task.kind === 'collect' && task.artifactId) {
    const artifact = obs.artifacts.find((entry) => entry.id === task.artifactId);
    if (artifact?.phase === 'onField') {
      return { x: artifact.pose.x, y: artifact.pose.y };
    }
  }

  if (task.kind === 'score' || task.kind === 'auto_hold') {
    const inLaunch = robotInLaunchZone(obs.self.pose, obs.footprint, obs.field);
    if (!inLaunch) {
      return launchApproachForRobot(robotId, obs.self.alliance);
    }
  }

  return { ...task.target };
}

export function taskIncomplete(
  obs: BotObservation,
  task: BotTaskGoal,
  robotId: string,
  driveTarget: Vector2,
): boolean {
  const dist = Math.hypot(driveTarget.x - obs.self.pose.x, driveTarget.y - obs.self.pose.y);
  if (task.kind === 'collect') {
    return dist > 6;
  }
  if (task.kind === 'score') {
    const inLaunch = robotInLaunchZone(obs.self.pose, obs.footprint, obs.field);
    return !inLaunch || dist > 8;
  }
  if (task.kind === 'idle') {
    return false;
  }
  return dist > TASK_ARRIVE_IN;
}

export class TaskNavigator {
  private motion = new MotionExecutor();

  followPath(waypoints: Vector2[], finalHeading?: number): boolean {
    return this.motion.followPathIfChanged(waypoints, finalHeading);
  }

  clear(): void {
    this.motion.clear();
  }

  isAtGoal(pose: Pose, goal: Vector2, toleranceIn = 5): boolean {
    return this.motion.isAtGoal(pose, goal, toleranceIn);
  }

  get goal(): Vector2 | null {
    return this.motion.goal;
  }

  get pathSignature(): string {
    return this.motion.pathSignature;
  }

  get pathLength(): number {
    return this.motion.pathLength;
  }

  getDebug(pose: Pose) {
    return this.motion.getDebug(pose);
  }

  update(
    obs: BotObservation,
    task: BotTaskGoal,
    robotId: string,
    pathWaypoints: Vector2[],
    dt: number,
    maxAccel: number,
    needsReposition: boolean,
  ): HolonomicInput {
    const driveTarget = resolveDriveTarget(obs, task, robotId);
    const dist = Math.hypot(driveTarget.x - obs.self.pose.x, driveTarget.y - obs.self.pose.y);
    const incomplete = taskIncomplete(obs, task, robotId, driveTarget);

    if (task.kind === 'idle' || task.kind === 'park') {
      if (dist < TASK_ARRIVE_IN && task.targetHeading !== undefined) {
        const err = normalizeAngle(task.targetHeading - obs.self.pose.heading);
        if (Math.abs(err) > 0.08) {
          return fieldRotateToward(obs.self.pose, task.targetHeading);
        }
      }
      if (dist < TASK_ARRIVE_IN) {
        return { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true };
      }
    }

    if (
      (task.kind === 'score' || task.kind === 'auto_hold') &&
      robotInLaunchZone(obs.self.pose, obs.footprint, obs.field) &&
      obs.self.stored.length > 0
    ) {
      return { forward: 0, strafe: 0, turn: 0, brake: true };
    }

    if (needsReposition || dist <= DIRECT_DRIVE_RADIUS_IN || pathWaypoints.length < 2) {
      if (dist < TASK_ARRIVE_IN && task.targetHeading !== undefined && incomplete) {
        return fieldRotateToward(obs.self.pose, task.targetHeading);
      }
      return fieldStrafeToward(obs.self.pose, driveTarget, obs.limits);
    }

    const offPath = nearestPathDist(pathWaypoints, obs.self.pose);
    const motionInput = this.motion.update(
      obs.self.pose,
      obs.self.linear,
      dt,
      obs.limits,
      maxAccel,
    );
    const motionDebug = this.motion.getDebug(obs.self.pose);
    const atPathEnd = motionDebug.atEndpoint;
    const braking =
      Math.abs(motionInput.forward ?? 0) < 0.05 &&
      Math.abs(motionInput.strafe ?? 0) < 0.05 &&
      (motionInput.brake || motionInput.endpointBrake);

    if (incomplete && (atPathEnd || braking || offPath > OFF_PATH_IN)) {
      return fieldStrafeToward(obs.self.pose, driveTarget, obs.limits);
    }

    return motionInput;
  }
}
