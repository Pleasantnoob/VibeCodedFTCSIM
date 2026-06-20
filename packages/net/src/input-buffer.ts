export class InputBuffer {
  private latest: import('./protocol.js').InputFrame | null = null;

  set(frame: import('./protocol.js').InputFrame): void {
    this.latest = frame;
  }

  consume(): import('./protocol.js').InputFrame | null {
    const frame = this.latest;
    this.latest = null;
    return frame;
  }

  clear(): void {
    this.latest = null;
  }
}
