import type { Pose, Vector2 } from '@ftc-sim/field';
import { distance, normalizeAngle, rotateVector } from '@ftc-sim/field';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import { PIDFController } from './control.js';
import type { PathChain, Path } from './paths.js';

export interface FollowerErrors {
  translational: number;
  heading: number;
  drive: number;
}

export interface PathProgress {
  tValue: number;
  completion: number;
  distanceRemaining: number;
  pathIndex: number;
}

export interface FollowerConstants {
  translationalP: number;
  translationalI: number;
  translationalD: number;
  translationalF: number;
  headingP: number;
  headingI: number;
  headingD: number;
  headingF: number;
  driveP: number;
  driveI: number;
  driveD: number;
  driveF: number;
  mass: number;
  centripetalScaling: number;
  useTranslational: boolean;
  useHeading: boolean;
  useDrive: boolean;
  useCentripetal: boolean;
}

export const DEFAULT_FOLLOWER_CONSTANTS: FollowerConstants = {
  translationalP: 0.3,
  translationalI: 0,
  translationalD: 0.03,
  translationalF: 0,
  headingP: 7,
  headingI: 0,
  headingD: 0.05,
  headingF: 0,
  driveP: 0.03,
  driveI: 0,
  driveD: 0.004,
  driveF: 0,
  mass: 10,
  centripetalScaling: 0.0005,
  useTranslational: true,
  useHeading: true,
  useDrive: true,
  useCentripetal: true,
};

/** Baseline feedforward was +0.5 (~60% effective cruise); 0.625 targets ~75%. */
const AUTO_DRIVE_FEEDFORWARD = 0.625;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampHolonomic(input: HolonomicInput): HolonomicInput {
  const { forward, strafe, turn } = input;
  const fl = forward + strafe + turn;
  const fr = forward - strafe - turn;
  const bl = forward - strafe + turn;
  const br = forward + strafe - turn;
  const max = Math.max(Math.abs(fl), Math.abs(fr), Math.abs(bl), Math.abs(br), 1);
  const scale = max > 1 ? 1 / max : 1;
  return {
    forward: clamp(forward * scale, -1, 1),
    strafe: clamp(strafe * scale, -1, 1),
    turn: clamp(turn * scale, -1, 1),
    brake: input.brake,
    endpointBrake: input.endpointBrake,
  };
}

export const PEDRO_SEGMENT_END_THRESHOLD = 2.5;

export class PedroFollower {
  /** Center must reach within this distance of the path endpoint. */
  private static readonly END_ARRIVE_IN = 1.0;
  private static readonly END_STOP_SPEED = 4;

  private pose: Pose = { x: 0, y: 0, heading: 0 };
  private velocity: Vector2 = { x: 0, y: 0 };
  private pathChain: PathChain | null = null;
  private busy = false;
  private chainCompletion = 0;
  private activePathIndex = 0;
  private currentPathIndex = 0;
  private currentT = 0;
  private lastTargetPose: Pose | null = null;

  private translationalPid: PIDFController;
  private headingPid: PIDFController;
  private drivePid: PIDFController;

  constructor(private constants: FollowerConstants = DEFAULT_FOLLOWER_CONSTANTS) {
    this.translationalPid = new PIDFController(
      constants.translationalP,
      constants.translationalI,
      constants.translationalD,
      constants.translationalF,
    );
    this.headingPid = new PIDFController(
      constants.headingP,
      constants.headingI,
      constants.headingD,
      constants.headingF,
    );
    this.drivePid = new PIDFController(
      constants.driveP,
      constants.driveI,
      constants.driveD,
      constants.driveF,
    );
  }

  setPose(pose: Pose): void {
    this.pose = { ...pose };
  }

  getPose(): Pose {
    return { ...this.pose };
  }

  getVelocity(): Vector2 {
    return { ...this.velocity };
  }

  setVelocity(v: Vector2): void {
    this.velocity = { ...v };
  }

  updateConstants(partial: Partial<FollowerConstants>): void {
    Object.assign(this.constants, partial);
  }

  followPath(chain: PathChain): void {
    this.pathChain = chain;
    this.busy = true;
    this.chainCompletion = 0;
    this.activePathIndex = 0;
    this.currentPathIndex = 0;
    this.currentT = 0;
    this.lastTargetPose = null;
    this.translationalPid.reset();
    this.headingPid.reset();
    this.drivePid.reset();
    this.chainCompletion = this.projectCompletionOnChain(this.pose);
  }

  isBusy(): boolean {
    return this.busy;
  }

  cancelPath(): void {
    this.busy = false;
    this.lastTargetPose = null;
  }

  /** Advance only when the robot reaches each segment end (no skipping ahead). */
  private syncActivePathIndex(pose: Pose): void {
    if (!this.pathChain) return;
    while (this.activePathIndex < this.pathChain.paths.length - 1) {
      const path = this.pathChain.paths[this.activePathIndex];
      if (distance(pose, path.curve.getEnd()) <= PEDRO_SEGMENT_END_THRESHOLD) {
        this.activePathIndex++;
      } else {
        break;
      }
    }
  }

  /** Arc-length progress for the active segment only. */
  private projectCompletionOnChain(pose: Pose): number {
    if (!this.pathChain || this.pathChain.paths.length === 0) return 0;

    this.syncActivePathIndex(pose);
    const total = this.pathChain.totalLength();
    let accumulated = 0;
    for (let i = 0; i < this.activePathIndex; i++) {
      accumulated += this.pathChain.paths[i].length();
    }
    const path = this.pathChain.paths[this.activePathIndex];
    const t = path.closestT(pose);
    return Math.min(1, (accumulated + t * path.length()) / total);
  }

  private activePath(): Path {
    return this.pathChain!.paths[this.activePathIndex];
  }

  getTargetPose(): Pose | null {
    return this.lastTargetPose ? { ...this.lastTargetPose } : null;
  }

  getErrors(): FollowerErrors {
    if (!this.pathChain) return { translational: 0, heading: 0, drive: 0 };
    const path = this.activePath();
    const t = path.closestT(this.pose);
    const target = path.getPose(t);
    const trans = distance(this.pose, target);
    const head = Math.abs(normalizeAngle(this.pose.heading - target.heading));
    return { translational: trans, heading: head, drive: 0 };
  }

  getProgress(): PathProgress {
    if (!this.pathChain) {
      return { tValue: 0, completion: 0, distanceRemaining: 0, pathIndex: 0 };
    }
    const remaining = (1 - this.chainCompletion) * this.pathChain.totalLength();
    return {
      tValue: this.currentT,
      completion: this.chainCompletion,
      distanceRemaining: remaining,
      pathIndex: this.currentPathIndex,
    };
  }

  updateHolonomic(dt: number, limits: KinematicLimits): HolonomicInput {
    if (!this.pathChain || !this.busy) {
      return { forward: 0, strafe: 0, turn: 0 };
    }

    const path = this.activePath();
    this.currentPathIndex = this.activePathIndex;
    this.currentT = path.closestT(this.pose);
    const closestPose = path.getPose(this.currentT);
    this.lastTargetPose = closestPose;

    const transError = {
      x: closestPose.x - this.pose.x,
      y: closestPose.y - this.pose.y,
    };

    const headingError = normalizeAngle(closestPose.heading - this.pose.heading);

    const tangent = path.curve.getTangent(this.currentT);
    const driveError = tangent.x * transError.x + tangent.y * transError.y;
    const normal = { x: -tangent.y, y: tangent.x };
    const lateralError = normal.x * transError.x + normal.y * transError.y;

    let transCorr = 0;
    if (this.constants.useTranslational && Math.abs(lateralError) > 0.01) {
      transCorr = this.translationalPid.update(lateralError, 0, dt);
    }

    let headCorr = 0;
    if (this.constants.useHeading) {
      headCorr = this.headingPid.update(headingError, 0, dt);
    }

    let driveCorr = 0;
    if (this.constants.useDrive) {
      driveCorr = this.drivePid.update(-driveError, 1, dt);
    }

    let centripetal = 0;
    if (this.constants.useCentripetal) {
      const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
      const curvature = path.curve.getCurvature(this.currentT);
      centripetal =
        this.constants.centripetalScaling * this.constants.mass * speed * speed * curvature;
    }

    const forward = tangent;

    const vx =
      forward.x * (driveCorr + AUTO_DRIVE_FEEDFORWARD) +
      normal.x * transCorr +
      forward.y * centripetal * 0.01;
    const vy =
      forward.y * (driveCorr + AUTO_DRIVE_FEEDFORWARD) +
      normal.y * transCorr -
      forward.x * centripetal * 0.01;

    const robotForward = rotateVector({ x: vx, y: vy }, -this.pose.heading);

    this.chainCompletion = this.projectCompletionOnChain(this.pose);

    const lastIndex = this.pathChain.paths.length - 1;
    const endPose = path.curve.getEnd();
    const distToEnd = distance(this.pose, endPose);
    const speed = Math.hypot(this.velocity.x, this.velocity.y);

    if (this.activePathIndex === lastIndex && this.currentT >= 0.99) {
      if (speed < PedroFollower.END_STOP_SPEED) {
        this.busy = false;
      }
      return clampHolonomic({
        forward: 0,
        strafe: 0,
        turn: 0,
        brake: true,
        endpointBrake: true,
      });
    }

    const overshot =
      this.activePathIndex === lastIndex && driveError > 0.15 && this.currentT >= 0.85;

    if (overshot) {
      if (distToEnd < PedroFollower.END_ARRIVE_IN && speed < PedroFollower.END_STOP_SPEED) {
        this.busy = false;
      }
      return clampHolonomic({
        forward: 0,
        strafe: 0,
        turn: 0,
        brake: true,
        endpointBrake: true,
      });
    }

    if (
      this.activePathIndex === lastIndex &&
      distToEnd < PedroFollower.END_ARRIVE_IN &&
      speed < PedroFollower.END_STOP_SPEED
    ) {
      this.busy = false;
      return clampHolonomic({
        forward: 0,
        strafe: 0,
        turn: 0,
        brake: true,
        endpointBrake: true,
      });
    }

    return clampHolonomic({
      forward: robotForward.x,
      strafe: robotForward.y,
      turn: headCorr / limits.maxAngularVelocity,
    });
  }
}

export class PathExecutionController {
  constructor(private follower: PedroFollower) {}

  loadPath(chain: PathChain): void {
    this.follower.followPath(chain);
  }

  update(dt: number, limits: KinematicLimits): HolonomicInput {
    return this.follower.updateHolonomic(dt, limits);
  }

  getProgress(): PathProgress {
    return this.follower.getProgress();
  }

  getErrors(): FollowerErrors {
    return this.follower.getErrors();
  }

  getTargetPose(): Pose | null {
    return this.follower.getTargetPose();
  }

  isBusy(): boolean {
    return this.follower.isBusy();
  }

  cancelPath(): void {
    this.follower.cancelPath();
  }
}
