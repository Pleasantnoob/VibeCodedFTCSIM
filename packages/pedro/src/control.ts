export class PIDFController {
  private integral = 0;
  private lastError = 0;

  constructor(
    private p: number,
    private i: number,
    private d: number,
    private f: number,
  ) {}

  reset(): void {
    this.integral = 0;
    this.lastError = 0;
  }

  update(error: number, feedforward = 0, dt = 0.008): number {
    this.integral += error * dt;
    const derivative = dt > 0 ? (error - this.lastError) / dt : 0;
    this.lastError = error;
    return this.p * error + this.i * this.integral + this.d * derivative + this.f * feedforward;
  }
}
