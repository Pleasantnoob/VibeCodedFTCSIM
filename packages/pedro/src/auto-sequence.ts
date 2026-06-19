import type { Pose } from '@ftc-sim/field';
import { distance } from '@ftc-sim/field';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import {
  DEFAULT_FOLLOWER_CONSTANTS,
  PEDRO_SEGMENT_END_THRESHOLD,
  PedroFollower,
  type FollowerConstants,
  type FollowerErrors,
  type PathProgress,
} from './follower.js';
import type { PathChain } from './paths.js';

export type AutoSequenceStep =
  | { kind: 'path'; chain: PathChain }
  | { kind: 'wait'; durationSec: number; name?: string };

export interface AutoSequence {
  /** Full path for field overlay (all segments connected). */
  displayChain: PathChain;
  steps: AutoSequenceStep[];
  startPose: Pose;
}

type RunnerPhase = 'idle' | 'path' | 'wait';

/**
 * Executes Pedro auto paths with explicit wait steps.
 * During waits the robot holds position and {@link shouldAutoShoot} is true.
 */
export class AutoSequenceRunner {
  private follower: PedroFollower;
  private steps: AutoSequenceStep[] = [];
  private stepIndex = 0;
  private phase: RunnerPhase = 'idle';
  private waitRemainingSec = 0;

  constructor(constants: FollowerConstants = DEFAULT_FOLLOWER_CONSTANTS) {
    this.follower = new PedroFollower(constants);
  }

  /** Legacy single-chain start (no waits). */
  followPath(chain: PathChain): void {
    this.start([{ kind: 'path', chain }]);
  }

  start(steps: AutoSequenceStep[]): void {
    this.steps = steps;
    this.stepIndex = 0;
    this.phase = 'idle';
    this.waitRemainingSec = 0;
    this.follower.cancelPath();
    this.beginCurrentStep();
  }

  cancelPath(): void {
    this.steps = [];
    this.stepIndex = 0;
    this.phase = 'idle';
    this.waitRemainingSec = 0;
    this.follower.cancelPath();
  }

  getPose(): Pose {
    return this.follower.getPose();
  }

  private currentPathStep(): Extract<AutoSequenceStep, { kind: 'path' }> | null {
    const step = this.steps[this.stepIndex];
    return step?.kind === 'path' ? step : null;
  }

  private atCurrentSegmentEnd(pose: Pose): boolean {
    const step = this.currentPathStep();
    if (!step || step.chain.paths.length === 0) return false;
    const end = step.chain.paths[step.chain.paths.length - 1]!.curve.getEnd();
    return distance(pose, end) <= PEDRO_SEGMENT_END_THRESHOLD;
  }

  setPose(pose: Pose): void {
    this.follower.setPose(pose);
  }

  setVelocity(v: { x: number; y: number }): void {
    this.follower.setVelocity(v);
  }

  updateConstants(partial: Partial<FollowerConstants>): void {
    this.follower.updateConstants(partial);
  }

  isBusy(): boolean {
    return this.phase !== 'idle';
  }

  /** True while any path or wait step is still executing. */
  isRunning(): boolean {
    return this.phase !== 'idle';
  }

  /** True while the runner is paused on a wait step (auto should fire balls). */
  shouldAutoShoot(): boolean {
    return this.phase === 'wait' && this.waitRemainingSec > 0;
  }

  getTargetPose(): Pose | null {
    return this.follower.getTargetPose();
  }

  getErrors(): FollowerErrors {
    return this.follower.getErrors();
  }

  getProgress(): PathProgress {
    return this.follower.getProgress();
  }

  updateHolonomic(dt: number, limits: KinematicLimits): HolonomicInput {
    if (this.phase === 'wait') {
      this.waitRemainingSec -= dt;
      if (this.waitRemainingSec > 0) {
        return { forward: 0, strafe: 0, turn: 0, brake: true };
      }
      this.waitRemainingSec = 0;
      this.stepIndex++;
      this.beginCurrentStep();
    }

    if (this.phase === 'path') {
      const input = this.follower.updateHolonomic(dt, limits);
      const segmentDone =
        !this.follower.isBusy() || this.atCurrentSegmentEnd(this.follower.getPose());
      if (segmentDone) {
        if (this.follower.isBusy()) {
          this.follower.cancelPath();
        }
        this.stepIndex++;
        this.beginCurrentStep();
        if (this.phase === 'path' && this.follower.isBusy()) {
          return this.follower.updateHolonomic(dt, limits);
        }
        return { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true };
      }
      return input;
    }

    return { forward: 0, strafe: 0, turn: 0 };
  }

  private beginCurrentStep(): void {
    while (this.stepIndex < this.steps.length) {
      const step = this.steps[this.stepIndex]!;
      if (step.kind === 'wait') {
        this.phase = 'wait';
        this.waitRemainingSec = step.durationSec;
        this.follower.cancelPath();
        return;
      }

      this.phase = 'path';
      this.follower.followPath(step.chain);
      return;
    }

    this.phase = 'idle';
    this.follower.cancelPath();
  }
}
