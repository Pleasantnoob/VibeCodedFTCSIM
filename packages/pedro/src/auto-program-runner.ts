import type { Pose } from '@ftc-sim/field';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import { AutoSequenceRunner, type AutoSequenceStep } from './auto-sequence.js';
import type { FollowerErrors, PathProgress } from './follower.js';
import type { PathChain } from './paths.js';
import {
  type ProgramStep,
  type ResolvedAutoProgram,
  type StoredCountWait,
  findLeaveModuleId,
  storedCountWaitMet,
  waitShouldIntake,
  waitShouldShoot,
  waitSpecForId,
} from './auto-program.js';
import {
  defaultLeaveSafetyMarginSec,
  effectiveAutoCruiseSpeedInS,
  estimateLeaveBudgetSec,
  shouldStopLoopForLeave,
} from './leave-budget.js';
import { DEFAULT_LEAVE_SAFETY_MARGIN_SEC } from './auto-program.js';

export interface AutoProgramContext {
  storedCount: number;
  timeRemainingSec: number;
  inLaunchZone: boolean;
}

export interface AutoProgramWaitConfig {
  intakeFullWaitTimeoutSec: number;
  shootEmptyWaitTimeoutSec: number;
  leaveSafetyMarginSec: number;
}

export const DEFAULT_AUTO_PROGRAM_WAIT_CONFIG: AutoProgramWaitConfig = {
  intakeFullWaitTimeoutSec: 2.5,
  shootEmptyWaitTimeoutSec: 4.0,
  leaveSafetyMarginSec: DEFAULT_LEAVE_SAFETY_MARGIN_SEC,
};

type RunnerMode = 'idle' | 'simple' | 'program';
type ProgramPhase = 'module' | 'conditionalWait';

interface ActiveLoop {
  body: ProgramStep[];
  index: number;
}

interface ConditionalWaitState {
  waitId: string;
  spec: StoredCountWait;
  elapsedSec: number;
  timeoutSec: number;
}

export interface AutoProgramRunnerDebug {
  mode: RunnerMode;
  programPhase: ProgramPhase | 'idle';
  stepIndex: number;
  stepCount: number;
  loopCount: number;
  waitKind: string | null;
  waitElapsedSec: number;
  leaveBudgetSec: number;
  sequence: ReturnType<AutoSequenceRunner['getRunnerDebug']>;
}

/**
 * Player AUTO: simple flat sequences or modular programs with loops and game-state waits.
 */
export class AutoProgramRunner {
  private sequenceRunner = new AutoSequenceRunner();
  private mode: RunnerMode = 'idle';
  private resolved: ResolvedAutoProgram | null = null;
  private stepIndex = 0;
  private activeLoop: ActiveLoop | null = null;
  private programPhase: ProgramPhase | 'idle' = 'idle';
  private conditionalWait: ConditionalWaitState | null = null;
  private leaveBudgetSec = 0;
  private loopCount = 0;
  private context: AutoProgramContext = {
    storedCount: 0,
    timeRemainingSec: 30,
    inLaunchZone: false,
  };
  private waitConfig: AutoProgramWaitConfig = { ...DEFAULT_AUTO_PROGRAM_WAIT_CONFIG };

  setContext(ctx: Partial<AutoProgramContext>): void {
    this.context = { ...this.context, ...ctx };
    this.sequenceRunner.setContext({
      storedCount: ctx.storedCount ?? this.context.storedCount,
      inLaunchZone: ctx.inLaunchZone ?? this.context.inLaunchZone,
    });
  }

  setWaitConfig(config: Partial<AutoProgramWaitConfig>): void {
    this.waitConfig = { ...this.waitConfig, ...config };
    this.sequenceRunner.setWaitTimeouts({
      intakeFullWaitTimeoutSec: this.waitConfig.intakeFullWaitTimeoutSec,
      shootEmptyWaitTimeoutSec: this.waitConfig.shootEmptyWaitTimeoutSec,
    });
  }

  /** Legacy single .pp / flat sequence (no program layer). */
  startSimple(steps: AutoSequenceStep[]): void {
    this.cancelPath();
    this.mode = 'simple';
    this.sequenceRunner.start(steps);
  }

  followPath(chain: PathChain): void {
    this.startSimple([{ kind: 'path', chain }]);
  }

  startProgram(
    resolved: ResolvedAutoProgram,
    maxVelocity: number,
    waitConfig?: Partial<AutoProgramWaitConfig>,
  ): void {
    this.cancelPath();
    if (waitConfig) this.setWaitConfig(waitConfig);
    this.mode = 'program';
    this.resolved = resolved;
    this.stepIndex = 0;
    this.activeLoop = null;
    this.loopCount = 0;
    this.programPhase = 'idle';

    const leaveId = findLeaveModuleId(resolved.program);
    const leaveSeq = leaveId ? resolved.moduleSequences.get(leaveId) : null;
    const safety = defaultLeaveSafetyMarginSec(
      waitConfig?.leaveSafetyMarginSec ??
        resolved.program.leave?.safetyMarginSec ??
        this.waitConfig.leaveSafetyMarginSec,
    );
    const cruise = effectiveAutoCruiseSpeedInS(maxVelocity);
    this.leaveBudgetSec = leaveSeq
      ? estimateLeaveBudgetSec(leaveSeq.steps, safety, cruise)
      : safety + 4;

    this.advanceProgram();
  }

  cancelPath(): void {
    this.mode = 'idle';
    this.resolved = null;
    this.stepIndex = 0;
    this.activeLoop = null;
    this.programPhase = 'idle';
    this.conditionalWait = null;
    this.loopCount = 0;
    this.sequenceRunner.cancelPath();
  }

  setPose(pose: Pose): void {
    this.sequenceRunner.setPose(pose);
  }

  setVelocity(v: { x: number; y: number }): void {
    this.sequenceRunner.setVelocity(v);
  }

  updateConstants(partial: { mass?: number }): void {
    this.sequenceRunner.updateConstants(partial);
  }

  isRunning(): boolean {
    if (this.mode === 'simple') return this.sequenceRunner.isRunning();
    if (this.mode === 'program') {
      return (
        this.programPhase !== 'idle' ||
        this.stepIndex < (this.resolved?.program.steps.length ?? 0) ||
        this.activeLoop !== null
      );
    }
    return false;
  }

  isBusy(): boolean {
    return this.isRunning();
  }

  isInAutoWait(): boolean {
    if (this.mode === 'program' && this.programPhase === 'conditionalWait') {
      return this.conditionalWait !== null;
    }
    return this.sequenceRunner.isInAutoWait();
  }

  shouldAutoShoot(inLaunchZone: boolean): boolean {
    if (this.mode === 'program' && this.programPhase === 'conditionalWait' && this.conditionalWait) {
      if (!waitShouldShoot(this.conditionalWait.spec)) return false;
      return inLaunchZone && this.context.storedCount > 0;
    }
    if (this.mode === 'program' && this.programPhase === 'module') {
      return this.sequenceRunner.shouldAutoShoot(inLaunchZone);
    }
    return this.sequenceRunner.shouldAutoShoot(inLaunchZone);
  }

  shouldAutoIntake(): boolean {
    if (this.mode === 'program' && this.programPhase === 'conditionalWait' && this.conditionalWait) {
      return waitShouldIntake(this.conditionalWait.spec);
    }
    return this.sequenceRunner.shouldAutoIntake();
  }

  getTargetPose(): Pose | null {
    return this.sequenceRunner.getTargetPose();
  }

  getErrors(): FollowerErrors {
    return this.sequenceRunner.getErrors();
  }

  getProgress(): PathProgress {
    return this.sequenceRunner.getProgress();
  }

  getPose(): Pose {
    return this.sequenceRunner.getPose();
  }

  getRunnerDebug(): AutoProgramRunnerDebug {
    const stepCount = this.resolved?.program.steps.length ?? 0;
    return {
      mode: this.mode,
      programPhase: this.programPhase,
      stepIndex: this.stepIndex,
      stepCount,
      loopCount: this.loopCount,
      waitKind: this.conditionalWait?.waitId ?? null,
      waitElapsedSec: this.conditionalWait?.elapsedSec ?? 0,
      leaveBudgetSec: this.leaveBudgetSec,
      sequence: this.sequenceRunner.getRunnerDebug(),
    };
  }

  updateHolonomic(dt: number, limits: KinematicLimits): HolonomicInput {
    if (this.mode === 'simple') {
      return this.sequenceRunner.updateHolonomic(dt, limits);
    }

    if (this.mode === 'program') {
      if (this.programPhase === 'conditionalWait') {
        return this.tickConditionalWait(dt);
      }
      if (this.programPhase === 'module') {
        const input = this.sequenceRunner.updateHolonomic(dt, limits);
        if (!this.sequenceRunner.isRunning()) {
          this.onModuleComplete();
          const phaseAfter = this.programPhase as ProgramPhase | 'idle';
          if (phaseAfter === 'module' && this.sequenceRunner.isRunning()) {
            return this.sequenceRunner.updateHolonomic(dt, limits);
          }
          if (phaseAfter === 'conditionalWait') {
            return this.tickConditionalWait(dt);
          }
        }
        return input;
      }
      this.advanceProgram();
      const phaseAfterAdvance = this.programPhase as ProgramPhase | 'idle';
      if (phaseAfterAdvance === 'module' && this.sequenceRunner.isRunning()) {
        return this.sequenceRunner.updateHolonomic(dt, limits);
      }
      if (phaseAfterAdvance === 'conditionalWait') {
        return this.tickConditionalWait(dt);
      }
    }

    return { forward: 0, strafe: 0, turn: 0 };
  }

  private tickConditionalWait(dt: number): HolonomicInput {
    const wait = this.conditionalWait;
    if (!wait) {
      this.programPhase = 'idle';
      return { forward: 0, strafe: 0, turn: 0 };
    }

    wait.elapsedSec += dt;

    if (storedCountWaitMet(wait.spec, this.context.storedCount)) {
      this.conditionalWait = null;
      this.programPhase = 'idle';
      this.advanceStepPointer();
      this.advanceProgram();
      const phaseAfterWait = this.programPhase as ProgramPhase | 'idle';
      if (phaseAfterWait === 'module' && this.sequenceRunner.isRunning()) {
        return this.sequenceRunner.updateHolonomic(0, { maxVelocity: 0, maxAngularVelocity: 0 });
      }
      return { forward: 0, strafe: 0, turn: 0, brake: true };
    }

    if (wait.elapsedSec >= wait.timeoutSec) {
      if (wait.spec.onTimeout === 'abort') {
        this.cancelPath();
        return { forward: 0, strafe: 0, turn: 0, brake: true };
      }
      this.conditionalWait = null;
      this.programPhase = 'idle';
      this.advanceStepPointer();
      this.advanceProgram();
      return { forward: 0, strafe: 0, turn: 0, brake: true };
    }

    return { forward: 0, strafe: 0, turn: 0, brake: true };
  }

  private onModuleComplete(): void {
    this.programPhase = 'idle';
    this.advanceStepPointer();
    this.advanceProgram();
  }

  private advanceStepPointer(): void {
    if (this.activeLoop) {
      this.activeLoop.index += 1;
      if (this.activeLoop.index >= this.activeLoop.body.length) {
        if (shouldStopLoopForLeave(this.context.timeRemainingSec, this.leaveBudgetSec)) {
          this.activeLoop = null;
          this.stepIndex += 1;
        } else {
          this.activeLoop.index = 0;
          this.loopCount += 1;
        }
      }
      return;
    }
    this.stepIndex += 1;
  }

  private advanceProgram(): void {
    if (!this.resolved) return;

    while (true) {
      const step = this.currentProgramStep();
      if (!step) {
        this.mode = 'idle';
        this.programPhase = 'idle';
        return;
      }

      if ('run' in step) {
        const seq = this.resolved.moduleSequences.get(step.run);
        if (!seq) {
          this.cancelPath();
          return;
        }
        this.programPhase = 'module';
        this.sequenceRunner.start(seq.steps);
        return;
      }

      if ('waitUntil' in step) {
        const spec = waitSpecForId(this.resolved.program, step.waitUntil);
        const timeoutSec = this.timeoutForWait(step.waitUntil, spec.timeoutSec);
        if (storedCountWaitMet(spec, this.context.storedCount)) {
          this.advanceStepPointer();
          continue;
        }
        this.programPhase = 'conditionalWait';
        this.conditionalWait = {
          waitId: step.waitUntil,
          spec,
          elapsedSec: 0,
          timeoutSec,
        };
        return;
      }

      if ('loop' in step) {
        if (!this.activeLoop) {
          if (shouldStopLoopForLeave(this.context.timeRemainingSec, this.leaveBudgetSec)) {
            this.stepIndex += 1;
            continue;
          }
          this.activeLoop = { body: step.loop.body, index: 0 };
        }
        const inner = this.activeLoop.body[this.activeLoop.index];
        if (!inner) {
          this.activeLoop = null;
          this.stepIndex += 1;
          continue;
        }
        this.executeStep(inner);
        return;
      }
    }
  }

  private executeStep(step: ProgramStep): void {
    if (!this.resolved) return;

    if ('run' in step) {
      const seq = this.resolved.moduleSequences.get(step.run);
      if (!seq) {
        this.cancelPath();
        return;
      }
      this.programPhase = 'module';
      this.sequenceRunner.start(seq.steps);
      return;
    }

    if ('waitUntil' in step) {
      const spec = waitSpecForId(this.resolved.program, step.waitUntil);
      const timeoutSec = this.timeoutForWait(step.waitUntil, spec.timeoutSec);
      if (storedCountWaitMet(spec, this.context.storedCount)) {
        this.advanceStepPointer();
        this.advanceProgram();
        return;
      }
      this.programPhase = 'conditionalWait';
      this.conditionalWait = {
        waitId: step.waitUntil,
        spec,
        elapsedSec: 0,
        timeoutSec,
      };
      return;
    }

    if ('loop' in step) {
      throw new Error('Nested loops are not supported');
    }
  }

  private currentProgramStep(): ProgramStep | null {
    if (this.activeLoop) {
      return this.activeLoop.body[this.activeLoop.index] ?? null;
    }
    return this.resolved?.program.steps[this.stepIndex] ?? null;
  }

  private timeoutForWait(waitId: string, programTimeout: number): number {
    if (waitId === 'storedFull') {
      return this.waitConfig.intakeFullWaitTimeoutSec || programTimeout;
    }
    if (waitId === 'storedEmpty') {
      return this.waitConfig.shootEmptyWaitTimeoutSec || programTimeout;
    }
    return programTimeout;
  }
}
