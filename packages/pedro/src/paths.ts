import type { Pose } from '@ftc-sim/field';
import { normalizeAngle } from '@ftc-sim/field';
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

  closestT(robotPose: Pose, iterations = 10): number {
    let t = 0.5;
    for (let i = 0; i < iterations; i++) {
      const p = this.curve.getPose(t);
      const tan = this.curve.getTangent(t);
      const dx = robotPose.x - p.x;
      const dy = robotPose.y - p.y;
      const dot = dx * tan.x + dy * tan.y;
      t = Math.max(0, Math.min(1, t + dot * 0.01));
    }
    return t;
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
