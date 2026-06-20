import type { InputFrame } from './protocol.js';

export class InputBuffer {
  private latest: InputFrame | null = null;

  set(frame: InputFrame): void {
    this.latest = frame;
  }

  /** Last received frame — held until replaced (not one-shot per tick). */
  peekLatest(): InputFrame | null {
    return this.latest;
  }

  /** @deprecated Use peekLatest — kept for callers migrating off one-shot consume. */
  consume(): InputFrame | null {
    return this.peekLatest();
  }

  /** Clear rising-edge flags after the server applies one sim tick. */
  clearEdges(): void {
    if (!this.latest) return;
    if (!this.latest.shootEdge && !this.latest.gateEdge) return;
    this.latest = {
      ...this.latest,
      shootEdge: false,
      gateEdge: false,
    };
  }

  clear(): void {
    this.latest = null;
  }
}
