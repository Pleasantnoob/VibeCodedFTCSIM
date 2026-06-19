import type { Pose, Vector2 } from '@ftc-sim/field';
import { normalizeAngle } from '@ftc-sim/field';

export type { Pose, Vector2 };

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    heading: lerpAngle(a.heading, b.heading, t),
  };
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = normalizeAngle(b - a);
  return normalizeAngle(a + diff * t);
}

export abstract class Curve {
  abstract getStart(): Pose;
  abstract getEnd(): Pose;
  abstract length(): number;
  abstract getPose(t: number): Pose;
  abstract getTangent(t: number): Vector2;
  abstract getCurvature(t: number): number;
  getPathCompletion(t: number): number {
    return t;
  }
  getT(pathCompletion: number): number {
    return pathCompletion;
  }
}

export class BezierLine extends Curve {
  constructor(
    private readonly start: Pose,
    private readonly end: Pose,
  ) {
    super();
  }

  getStart(): Pose {
    return { ...this.start };
  }

  getEnd(): Pose {
    return { ...this.end };
  }

  length(): number {
    return distance(this.start, this.end);
  }

  getPose(t: number): Pose {
    return lerpPose(this.start, this.end, t);
  }

  getTangent(_t: number): Vector2 {
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  getCurvature(_t: number): number {
    return 0;
  }
}

export class BezierCurve extends Curve {
  private readonly p0: Pose;
  private readonly p1: Pose;
  private readonly p2: Pose;
  private readonly p3: Pose;
  private cachedLength = -1;

  constructor(
    start: Pose,
    control1: Vector2,
    control2: Vector2,
    end: Pose,
  ) {
    super();
    this.p0 = start;
    this.p1 = { x: control1.x, y: control1.y, heading: start.heading };
    this.p2 = { x: control2.x, y: control2.y, heading: end.heading };
    this.p3 = end;
  }

  getStart(): Pose {
    return { ...this.p0 };
  }

  getEnd(): Pose {
    return { ...this.p3 };
  }

  getControlPoint1(): Vector2 {
    return { x: this.p1.x, y: this.p1.y };
  }

  getControlPoint2(): Vector2 {
    return { x: this.p2.x, y: this.p2.y };
  }

  private evalPoint(t: number): Vector2 {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
      x: uuu * this.p0.x + 3 * uu * t * this.p1.x + 3 * u * tt * this.p2.x + ttt * this.p3.x,
      y: uuu * this.p0.y + 3 * uu * t * this.p1.y + 3 * u * tt * this.p2.y + ttt * this.p3.y,
    };
  }

  private evalDerivative(t: number): Vector2 {
    const u = 1 - t;
    return {
      x:
        3 * u * u * (this.p1.x - this.p0.x) +
        6 * u * t * (this.p2.x - this.p1.x) +
        3 * t * t * (this.p3.x - this.p2.x),
      y:
        3 * u * u * (this.p1.y - this.p0.y) +
        6 * u * t * (this.p2.y - this.p1.y) +
        3 * t * t * (this.p3.y - this.p2.y),
    };
  }

  length(): number {
    if (this.cachedLength >= 0) return this.cachedLength;
    let len = 0;
    let prev = this.evalPoint(0);
    for (let i = 1; i <= 50; i++) {
      const pt = this.evalPoint(i / 50);
      len += distance(prev, pt);
      prev = pt;
    }
    this.cachedLength = len;
    return len;
  }

  getPose(t: number): Pose {
    const pt = this.evalPoint(t);
    const tan = this.getTangent(t);
    return { x: pt.x, y: pt.y, heading: Math.atan2(tan.y, tan.x) };
  }

  getTangent(t: number): Vector2 {
    const d = this.evalDerivative(t);
    const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
    return { x: d.x / len, y: d.y / len };
  }

  getCurvature(t: number): number {
    const d = this.evalDerivative(t);
    const dd = {
      x:
        6 * (1 - t) * (this.p2.x - 2 * this.p1.x + this.p0.x) +
        6 * t * (this.p3.x - 2 * this.p2.x + this.p1.x),
      y:
        6 * (1 - t) * (this.p2.y - 2 * this.p1.y + this.p0.y) +
        6 * t * (this.p3.y - 2 * this.p2.y + this.p1.y),
    };
    const cross = d.x * dd.y - d.y * dd.x;
    const speed = Math.pow(d.x * d.x + d.y * d.y, 1.5) || 1;
    return cross / speed;
  }
}
