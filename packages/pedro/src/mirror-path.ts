import {
  FIELD_SIZE_INCHES,
  mirrorX,
  normalizeAngle,
  type Pose,
  type Vector2,
} from '@ftc-sim/field';
import { BezierCurve, BezierLine, type Curve } from './geometry.js';
import type { AutoSequence, AutoSequenceStep } from './auto-sequence.js';
import {
  constantHeading,
  linearHeading,
  Path,
  PathChain,
  tangentHeading,
  type HeadingInterpolator,
} from './paths.js';

/** Paths are authored for blue alliance; mirror across field center for red. */
export const PATH_AUTHORING_ALLIANCE = 'blue' as const;

export function mirrorPedroPoint(point: Vector2, fieldSize = FIELD_SIZE_INCHES): Vector2 {
  return { x: mirrorX(point.x, fieldSize), y: point.y };
}

export function mirrorPedroPose(pose: Pose, fieldSize = FIELD_SIZE_INCHES): Pose {
  return {
    x: mirrorX(pose.x, fieldSize),
    y: pose.y,
    heading: normalizeAngle(Math.PI - pose.heading),
  };
}

function mirrorCurve(curve: Curve): Curve {
  if (curve instanceof BezierLine) {
    return new BezierLine(mirrorPedroPose(curve.getStart()), mirrorPedroPose(curve.getEnd()));
  }
  if (curve instanceof BezierCurve) {
    return new BezierCurve(
      mirrorPedroPose(curve.getStart()),
      mirrorPedroPoint(curve.getControlPoint1()),
      mirrorPedroPoint(curve.getControlPoint2()),
      mirrorPedroPose(curve.getEnd()),
    );
  }
  throw new Error('Unsupported curve type for mirroring');
}

function inferLinearEndTime(path: Path): number {
  const endHeading = path.getPose(1).heading;
  for (let i = 1; i <= 20; i++) {
    const endTime = i / 20;
    const headingAtEndTime = path.getPose(Math.min(endTime, 1)).heading;
    if (Math.abs(normalizeAngle(headingAtEndTime - endHeading)) < 0.02) {
      return endTime;
    }
  }
  return 0.8;
}

function mirrorHeadingInterpolator(path: Path): HeadingInterpolator {
  if (path.headingInterpolator === tangentHeading) {
    return tangentHeading;
  }

  const startHeading = path.getPose(0).heading;
  const endHeading = path.getPose(1).heading;
  const mirroredStart = normalizeAngle(Math.PI - startHeading);
  const mirroredEnd = normalizeAngle(Math.PI - endHeading);

  const midHeading = path.getPose(0.5).heading;
  const isConstant =
    Math.abs(normalizeAngle(midHeading - startHeading)) < 1e-4 &&
    Math.abs(normalizeAngle(endHeading - startHeading)) < 1e-4;

  if (isConstant) {
    return constantHeading(mirroredStart);
  }

  return linearHeading(mirroredStart, mirroredEnd, inferLinearEndTime(path));
}

export function mirrorPath(path: Path): Path {
  return new Path(mirrorCurve(path.curve), mirrorHeadingInterpolator(path), {
    ...path.constraints,
  });
}

export function mirrorPathChain(chain: PathChain): PathChain {
  return new PathChain(
    chain.paths.map(mirrorPath),
    chain.globalHeading === tangentHeading ? tangentHeading : chain.globalHeading,
  );
}

export function pathChainForAlliance(
  chain: PathChain,
  alliance: 'blue' | 'red',
  authoredAlliance: 'blue' | 'red' = PATH_AUTHORING_ALLIANCE,
): PathChain {
  return alliance === authoredAlliance ? chain : mirrorPathChain(chain);
}

function mirrorAutoSequenceStep(step: AutoSequenceStep): AutoSequenceStep {
  if (step.kind === 'wait') return step;
  return { kind: 'path', chain: mirrorPathChain(step.chain) };
}

export function autoSequenceForAlliance(
  sequence: AutoSequence,
  alliance: 'blue' | 'red',
  authoredAlliance: 'blue' | 'red' = PATH_AUTHORING_ALLIANCE,
): AutoSequence {
  if (alliance === authoredAlliance) return sequence;
  return {
    displayChain: mirrorPathChain(sequence.displayChain),
    steps: sequence.steps.map(mirrorAutoSequenceStep),
    startPose: mirrorPedroPose(sequence.startPose),
  };
}
