import type { Pose } from '@ftc-sim/field';
import { distance, normalizeAngle } from '@ftc-sim/field';
import type { Curve } from './geometry.js';

export interface HeadingInterpolator {
  interpolate(startHeading: number, endHeading: number, t: number, pathT: number): number;
}

export const tangentHeading: HeadingInterpolator = {
  interpolate(_s, _e, _t, pathT) {
    return pathT;
  },
};

export function linearHeading(start: number, end: number, endTime = 0.8): HeadingInterpolator {
  return {
    interpolate(s, e, t, _pathT) {
      const sh = s ?? start;
      const eh = e ?? end;
      const progress = Math.min(1, t / endTime);
      return normalizeAngle(sh + normalizeAngle(eh - sh) * progress);
    },
  };
}

export function constantHeading(heading: number): HeadingInterpolator {
  return {
    interpolate() {
      return heading;
    },
  };
}

export interface PathConstraints {
  tValueConstraint: number;
  velocityConstraint: number;
  translationalConstraint: number;
  headingConstraint: number;
  brakingStrength: number;
}

export const DEFAULT_PATH_CONSTRAINTS: PathConstraints = {
  tValueConstraint: 0.995,
  velocityConstraint: 0.1,
  translationalConstraint: 0.1,
  headingConstraint: 0.007,
  brakingStrength: 1.0,
};

export class Path {
  constructor(
    public readonly curve: Curve,
    public readonly headingInterpolator: HeadingInterpolator,
    public readonly constraints: PathConstraints = DEFAULT_PATH_CONSTRAINTS,
  ) {}

  length(): number {
    return this.curve.length();
  }

  getPose(t: number): Pose {
    const pose = this.curve.getPose(t);
    const tan = this.curve.getTangent(t);
    const tangentAngle = Math.atan2(tan.y, tan.x);
    pose.heading = this.headingInterpolator.interpolate(
      this.curve.getStart().heading,
      this.curve.getEnd().heading,
      t,
      tangentAngle,
    );
    return pose;
  }

  /**
   * Nearest point on the curve to the robot. Uses `hintT` so hairpin / loop-back beziers
   * do not jump to the wrong branch (common at Super Duo home at 57,12).
   */
  closestT(robotPose: Pose, hintT = 0): number {
    const lookAhead = 0.45;
    const hintDist =
      hintT > 0 ? distance(robotPose, this.curve.getPose(hintT)) : 0;
    const reacquire = hintDist > 10;
    const lookBehind = reacquire ? hintT : hintT < 0.02 ? 0 : 0.12;
    const lo = Math.max(0, hintT - lookBehind);
    const hi = reacquire ? 1 : Math.min(1, hintT + lookAhead);

    const coarseSteps = 40;
    let bestT = lo;
    let bestDist = Infinity;
    for (let i = 0; i <= coarseSteps; i++) {
      const t = lo + (i / coarseSteps) * (hi - lo);
      const p = this.curve.getPose(t);
      const d = distance(robotPose, p);
      if (d < bestDist) {
        bestDist = d;
        bestT = t;
      }
    }

    let left = Math.max(lo, bestT - 0.22);
    let right = Math.min(hi, bestT + 0.22);
    for (let i = 0; i < 14; i++) {
      const t1 = left + (right - left) / 3;
      const t2 = right - (right - left) / 3;
      const d1 = distance(robotPose, this.curve.getPose(t1));
      const d2 = distance(robotPose, this.curve.getPose(t2));
      if (d1 < d2) right = t2;
      else left = t1;
    }

    let result = (left + right) / 2;

    if (hintT > 0.05 && result < hintT - 0.15) {
      const hintDist = distance(robotPose, this.curve.getPose(hintT));
      const resultDist = distance(robotPose, this.curve.getPose(result));
      if (hintDist <= resultDist + 1.5) {
        result = hintT;
      }
    }

    return Math.max(lo, Math.min(hi, result));
  }
}

export class PathChain {
  constructor(
    public readonly paths: Path[],
    public readonly globalHeading?: HeadingInterpolator,
  ) {}

  totalLength(): number {
    return this.paths.reduce((s, p) => s + p.length(), 0);
  }

  getPathAt(completion: number): { path: Path; localT: number; pathIndex: number } {
    const total = this.totalLength();
    let target = completion * total;
    for (let i = 0; i < this.paths.length; i++) {
      const len = this.paths[i].length();
      if (target <= len || i === this.paths.length - 1) {
        return { path: this.paths[i], localT: Math.min(1, target / len), pathIndex: i };
      }
      target -= len;
    }
    const last = this.paths[this.paths.length - 1];
    return { path: last, localT: 1, pathIndex: this.paths.length - 1 };
  }
}

/** Start pose of the first path segment (used as robot spawn while path is loaded). */
export function getPathStartPose(chain: PathChain): Pose {
  if (chain.paths.length === 0) {
    throw new Error('PathChain has no paths');
  }
  return chain.paths[0].getPose(0);
}

export class PathBuilder {
  private paths: Path[] = [];
  private currentHeading: HeadingInterpolator = tangentHeading;
  private constraints = { ...DEFAULT_PATH_CONSTRAINTS };

  addPath(curve: Curve): this {
    this.paths.push(new Path(curve, this.currentHeading, { ...this.constraints }));
    this.currentHeading = tangentHeading;
    return this;
  }

  setLinearHeadingInterpolation(start: number, end: number, endTime = 0.8): this {
    this.currentHeading = linearHeading(start, end, endTime);
    return this;
  }

  setConstantHeadingInterpolation(heading: number): this {
    this.currentHeading = constantHeading(heading);
    return this;
  }

  setTangentHeadingInterpolation(): this {
    this.currentHeading = tangentHeading;
    return this;
  }

  setBrakingStrength(strength: number): this {
    this.constraints.brakingStrength = strength;
    return this;
  }

  build(): PathChain {
    return new PathChain([...this.paths]);
  }
}
