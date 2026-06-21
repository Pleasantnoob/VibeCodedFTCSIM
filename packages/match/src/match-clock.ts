import type { ControlSource, MatchPhase, MatchSnapshot, MatchTiming } from './types.js';

export const DEFAULT_MATCH_TIMING: MatchTiming = {
  autoSec: 30,
  transitionSec: 8,
  teleopSec: 120,
};

const TIMED_PHASES: MatchPhase[] = ['auto', 'transition', 'teleop'];

export class MatchClock {
  private phase: MatchPhase = 'setup';
  private timeElapsed = 0;
  private timeRemainingInPhase = 0;
  private running = false;
  private paused = false;
  private infiniteMode = false;
  private controlSource: ControlSource = 'none';

  constructor(private timing: MatchTiming = DEFAULT_MATCH_TIMING) {}

  reset(): void {
    this.phase = 'setup';
    this.timeElapsed = 0;
    this.timeRemainingInPhase = 0;
    this.running = false;
    this.paused = false;
    this.infiniteMode = false;
    this.controlSource = 'none';
  }

  initMatch(): void {
    this.infiniteMode = false;
    this.phase = 'init';
    this.controlSource = 'none';
  }

  startAuto(): void {
    this.infiniteMode = false;
    this.phase = 'auto';
    this.timeRemainingInPhase = this.timing.autoSec;
    this.running = true;
    this.paused = false;
    this.controlSource = 'autonomous';
  }

  private startTransition(): void {
    this.phase = 'transition';
    this.timeRemainingInPhase = this.timing.transitionSec;
    this.controlSource = 'autonomous';
  }

  startTeleop(): void {
    this.infiniteMode = false;
    this.phase = 'teleop';
    this.timeRemainingInPhase = this.timing.teleopSec;
    this.running = true;
    this.paused = false;
    this.controlSource = 'human';
  }

  /** Practice mode: teleop with no phase timer (runs until reset). */
  startInfinitePractice(): void {
    this.infiniteMode = true;
    this.phase = 'teleop';
    this.timeRemainingInPhase = Number.POSITIVE_INFINITY;
    this.running = true;
    this.paused = false;
    this.controlSource = 'human';
  }

  /** Force match to post (for testing / early end). */
  endMatch(): void {
    this.finishMatch();
  }

  private finishMatch(): void {
    this.phase = 'post';
    this.timeRemainingInPhase = 0;
    this.running = false;
    this.controlSource = 'none';
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  tick(dt: number): void {
    if (!this.running || this.paused) return;

    if (this.infiniteMode && this.phase === 'teleop') {
      this.timeElapsed += dt;
      return;
    }

    if (!TIMED_PHASES.includes(this.phase)) return;

    this.timeElapsed += dt;
    this.timeRemainingInPhase = Math.max(0, this.timeRemainingInPhase - dt);

    if (this.timeRemainingInPhase > 0) return;

    if (this.phase === 'auto') this.startTransition();
    else if (this.phase === 'transition') this.startTeleop();
    else if (this.phase === 'teleop') this.finishMatch();
  }

  snapshot(): MatchSnapshot {
    const allowsDrive =
      this.phase === 'teleop' && this.running && !this.paused;
    return {
      phase: this.phase,
      timeElapsed: this.timeElapsed,
      timeRemainingInPhase: this.timeRemainingInPhase,
      running: this.running,
      paused: this.paused,
      allowsDrive,
      controlSource: this.controlSource,
      infiniteMode: this.infiniteMode,
    };
  }

  /** v1-style: start auto from setup or init */
  start(): void {
    this.running = true;
    this.paused = false;
    if (this.phase === 'setup' || this.phase === 'init') {
      this.startAuto();
    }
  }
}
