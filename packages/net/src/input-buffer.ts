export class InputBuffer {
  private latest: import('./protocol.js').InputFrame | null = null;

  set(frame: import('./protocol.js').InputFrame): void {
    this.latest = frame;
  }

  consume(): import('./protocol.js').InputFrame | null {
    return this.latest;
  }

  clear(): void {
    this.latest = null;
  }
}
