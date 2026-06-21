import type { Pose } from '@ftc-sim/field';
import type { HolonomicInput } from '@ftc-sim/robot';

export type StuckPhase = 'normal' | 'backoff' | 'rotate';

export class StuckRecovery {
  private lastPose: Pose | null = null;
  private stillSince = 0;
  private phase: StuckPhase = 'normal';
  private phaseUntil = 0;
  private nowSec = 0;
  private enteredStuck = false;
  private pendingReplan = false;

  reset(): void {
    this.lastPose = null;
    this.stillSince = 0;
    this.phase = 'normal';
    this.phaseUntil = 0;
    this.enteredStuck = false;
    this.pendingReplan = false;
  }

  /** True once when stuck recovery begins. */
  consumeStuckEntry(): boolean {
    if (!this.enteredStuck) return false;
    this.enteredStuck = false;
    return true;
  }

  /** True once when a replan should fire due to stuck (not every tick). */
  consumeForceReplan(): boolean {
    if (!this.pendingReplan) return false;
    this.pendingReplan = false;
    return true;
  }

  /** Sustained lack of progress while nominally trying to drive. */
  isCollectStuck(): boolean {
    return this.phase === 'normal' && this.stillSince >= 2;
  }

  update(nowSec: number, pose: Pose, dt: number): HolonomicInput | null {
    this.nowSec = nowSec;

    if (this.phase !== 'normal') {
      if (nowSec >= this.phaseUntil) {
        if (this.phase === 'backoff') {
          this.phase = 'rotate';
          this.phaseUntil = nowSec + 0.35;
          return { forward: 0, strafe: 0, turn: 0.6 };
        }
        this.phase = 'normal';
        this.stillSince = 0;
        this.lastPose = { ...pose };
        return null;
      }
      if (this.phase === 'backoff') {
        return { forward: -0.5, strafe: 0, turn: 0 };
      }
      return { forward: 0, strafe: 0, turn: 0.6 };
    }

    if (!this.lastPose) {
      this.lastPose = { ...pose };
      return null;
    }

    const moved = Math.hypot(pose.x - this.lastPose.x, pose.y - this.lastPose.y);
    if (moved >= 0.06) {
      this.stillSince = 0;
      this.lastPose = { ...pose };
      return null;
    }

    this.stillSince += dt;
    if (this.stillSince >= 1.4) {
      this.phase = 'backoff';
      this.phaseUntil = nowSec + 0.35;
      this.stillSince = 0;
      this.enteredStuck = true;
      this.pendingReplan = true;
      return { forward: -0.5, strafe: 0, turn: 0 };
    }

    return null;
  }

  forceReplan(): boolean {
    return false;
  }

  get phaseName(): StuckPhase {
    return this.phase;
  }
}
