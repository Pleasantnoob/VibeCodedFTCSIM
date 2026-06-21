import type { DifficultyProfile } from './difficulty.js';

export interface PendingMechanism {
  intake?: number;
  shoot?: boolean;
  shootEdge?: boolean;
  shootHeld?: boolean;
  gate?: boolean;
  gateEdge?: boolean;
  releaseAtMs: number;
}

export class ReactionDelay {
  private pending: PendingMechanism | null = null;
  private rng: () => number;
  private nowMs = 0;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  setNowMs(nowMs: number): void {
    this.nowMs = nowMs;
  }

  queueMechanism(
    nowMs: number,
    profile: DifficultyProfile,
    mechanism: Omit<PendingMechanism, 'releaseAtMs'>,
  ): void {
    const span = profile.reactionDelayMaxMs - profile.reactionDelayMinMs;
    const delay = profile.reactionDelayMinMs + this.rng() * span;
    this.pending = { ...mechanism, releaseAtMs: nowMs + delay };
  }

  tick(nowMs: number): PendingMechanism | null {
    if (!this.pending) return null;
    if (nowMs >= this.pending.releaseAtMs) {
      const out = this.pending;
      this.pending = null;
      return out;
    }
    return null;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  peek(): Omit<PendingMechanism, 'releaseAtMs'> | null {
    if (!this.pending) return null;
    const { releaseAtMs: _releaseAt, ...rest } = this.pending;
    return rest;
  }

  get msRemaining(): number {
    if (!this.pending) return 0;
    return Math.max(0, this.pending.releaseAtMs - this.nowMs);
  }

  clear(): void {
    this.pending = null;
  }
}

export class InputSmoother {
  private forward = 0;
  private strafe = 0;
  private turn = 0;

  reset(): void {
    this.forward = 0;
    this.strafe = 0;
    this.turn = 0;
  }

  smooth(
    target: { forward: number; strafe: number; turn: number },
    dt: number,
    tau: number,
  ): { forward: number; strafe: number; turn: number } {
    const alpha = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    this.forward += (target.forward - this.forward) * alpha;
    this.strafe += (target.strafe - this.strafe) * alpha;
    this.turn += (target.turn - this.turn) * alpha;
    return { forward: this.forward, strafe: this.strafe, turn: this.turn };
  }
}
