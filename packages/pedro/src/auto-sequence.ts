import type { Pose } from '@ftc-sim/field';
import { distance, normalizeAngle } from '@ftc-sim/field';
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

export const AUTO_STORED_FULL_COUNT = 3;

export const DEFAULT_SEQUENCE_WAIT_TIMEOUTS = {
  intakeFullWaitTimeoutSec: 2.5,
  shootEmptyWaitTimeoutSec: 4.0,
} as const;

export interface AutoSequenceContext {
  storedCount: number;
  inLaunchZone: boolean;
}

export interface AutoSequenceWaitTimeouts {
  intakeFullWaitTimeoutSec?: number;
  shootEmptyWaitTimeoutSec?: number;
}

type RunnerPhase = 'idle' | 'path' | 'wait';
type WaitMode = 'intake' | 'shoot';

function classifyWaitStep(step: Extract<AutoSequenceStep, { kind: 'wait' }>, inLaunchZone: boolean): WaitMode {
  const name = step.name?.toLowerCase() ?? '';
  if (/shoot|score|fire|launch|empty/.test(name)) return 'shoot';
  if (/intake|collect|full/.test(name)) return 'intake';
  return inLaunchZone ? 'shoot' : 'intake';
}

function waitConditionMet(mode: WaitMode, storedCount: number): boolean {
  if (mode === 'shoot') return storedCount <= 0;
  return storedCount >= AUTO_STORED_FULL_COUNT;
}

/**
 * Executes Pedro auto paths with explicit wait steps.
 * Waits are state-based by default: intake until 3 stored, shoot until empty (with timeout fallback).
 */
export class AutoSequenceRunner {
  private follower: PedroFollower;
  private steps: AutoSequenceStep[] = [];
  private stepIndex = 0;
  private phase: RunnerPhase = 'idle';
  private waitMode: WaitMode = 'intake';
  private waitElapsedSec = 0;
  private waitTimeoutSec = 0;
  private context: AutoSequenceContext = { storedCount: 0, inLaunchZone: false };
  private waitTimeouts: AutoSequenceWaitTimeouts = { ...DEFAULT_SEQUENCE_WAIT_TIMEOUTS };

  constructor(constants: FollowerConstants = DEFAULT_FOLLOWER_CONSTANTS) {
    this.follower = new PedroFollower(constants);
  }

  setContext(ctx: Partial<AutoSequenceContext>): void {
    this.context = { ...this.context, ...ctx };
  }

  setWaitTimeouts(timeouts: Partial<AutoSequenceWaitTimeouts>): void {
    this.waitTimeouts = { ...this.waitTimeouts, ...timeouts };
  }

  /** Legacy single-chain start (no waits). */
  followPath(chain: PathChain): void {
    this.start([{ kind: 'path', chain }]);
  }

  start(steps: AutoSequenceStep[]): void {
    this.steps = steps;
    this.stepIndex = 0;
    this.phase = 'idle';
    this.waitElapsedSec = 0;
    this.waitTimeoutSec = 0;
    this.follower.cancelPath();
    this.beginCurrentStep();
  }

  cancelPath(): void {
    this.steps = [];
    this.stepIndex = 0;
    this.phase = 'idle';
    this.waitElapsedSec = 0;
    this.waitTimeoutSec = 0;
    this.follower.cancelPath();
  }

  getPose(): Pose {
    return this.follower.getPose();
  }

  private currentPathStep(): Extract<AutoSequenceStep, { kind: 'path' }> | null {
    const step = this.steps[this.stepIndex];
    return step?.kind === 'path' ? step : null;
  }

  private currentWaitStep(): Extract<AutoSequenceStep, { kind: 'wait' }> | null {
    const step = this.steps[this.stepIndex];
    return step?.kind === 'wait' ? step : null;
  }

  private atCurrentSegmentEnd(pose: Pose): boolean {
    const step = this.currentPathStep();
    if (!step || step.chain.paths.length === 0) return false;
    const path = step.chain.paths[step.chain.paths.length - 1]!;
    const end = path.curve.getEnd();
    const dist = distance(pose, end);

    if (path.length() < 0.5) {
      return Math.abs(normalizeAngle(pose.heading - end.heading)) < 0.05;
    }

    if (dist <= PEDRO_SEGMENT_END_THRESHOLD) return true;
    return false;
  }

  /** Debug snapshot for bot overlay / logs. */
  getRunnerDebug(): {
    phase: RunnerPhase;
    stepIndex: number;
    stepCount: number;
    waitRemainingSec: number;
    waitMode: WaitMode | null;
    segmentEndDist: number | null;
  } {
    const step = this.currentPathStep();
    let segmentEndDist: number | null = null;
    if (step && step.chain.paths.length > 0) {
      const end = step.chain.paths[step.chain.paths.length - 1]!.curve.getEnd();
      segmentEndDist = distance(this.follower.getPose(), end);
    }
    const waitRemainingSec =
      this.phase === 'wait' ? Math.max(0, this.waitTimeoutSec - this.waitElapsedSec) : 0;
    return {
      phase: this.phase,
      stepIndex: this.stepIndex,
      stepCount: this.steps.length,
      waitRemainingSec,
      waitMode: this.phase === 'wait' ? this.waitMode : null,
      segmentEndDist,
    };
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

  /** True while paused on a wait step before the state condition or timeout is met. */
  isInAutoWait(): boolean {
    if (this.phase !== 'wait') return false;
    return !waitConditionMet(this.waitMode, this.context.storedCount) && this.waitElapsedSec < this.waitTimeoutSec;
  }

  /** True during a shoot wait when part of the robot is inside a launch zone. */
  shouldAutoShoot(inLaunchZone: boolean): boolean {
    return this.isInAutoWait() && this.waitMode === 'shoot' && inLaunchZone;
  }

  /** True during an intake wait — hold intake until storage is full. */
  shouldAutoIntake(): boolean {
    return this.isInAutoWait() && this.waitMode === 'intake';
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
      this.waitElapsedSec += dt;
      if (
        waitConditionMet(this.waitMode, this.context.storedCount) ||
        this.waitElapsedSec >= this.waitTimeoutSec
      ) {
        this.waitElapsedSec = 0;
        this.waitTimeoutSec = 0;
        this.stepIndex++;
        this.beginCurrentStep();
      } else {
        return { forward: 0, strafe: 0, turn: 0, brake: true };
      }
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
        const phaseAfter = this.phase as RunnerPhase;
        if (phaseAfter === 'path' && this.follower.isBusy()) {
          return this.follower.updateHolonomic(dt, limits);
        }
        if (phaseAfter === 'wait') {
          return { forward: 0, strafe: 0, turn: 0, brake: true };
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
        this.waitMode = classifyWaitStep(step, this.context.inLaunchZone);
        this.waitElapsedSec = 0;
        const configTimeout =
          this.waitMode === 'shoot'
            ? (this.waitTimeouts.shootEmptyWaitTimeoutSec ??
              DEFAULT_SEQUENCE_WAIT_TIMEOUTS.shootEmptyWaitTimeoutSec)
            : (this.waitTimeouts.intakeFullWaitTimeoutSec ??
              DEFAULT_SEQUENCE_WAIT_TIMEOUTS.intakeFullWaitTimeoutSec);
        this.waitTimeoutSec = Math.max(step.durationSec, configTimeout);
        this.follower.cancelPath();
        if (waitConditionMet(this.waitMode, this.context.storedCount)) {
          this.stepIndex++;
          continue;
        }
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
