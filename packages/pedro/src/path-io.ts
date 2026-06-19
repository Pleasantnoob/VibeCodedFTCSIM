import type { Pose } from '@ftc-sim/field';
import { BezierCurve, BezierLine } from './geometry.js';
import {
  constantHeading,
  linearHeading,
  Path,
  PathBuilder,
  PathChain,
  tangentHeading,
  type HeadingInterpolator,
} from './paths.js';

export interface PedroJsonPoint {
  x: number;
  y: number;
}

export interface PedroJsonPathSegment {
  type: 'BezierLine' | 'BezierCurve';
  startPoint: PedroJsonPoint;
  endPoint: PedroJsonPoint;
  controlPoint1?: PedroJsonPoint;
  controlPoint2?: PedroJsonPoint;
  headingInterpolation?: {
    mode: 'tangent' | 'linear' | 'constant';
    startHeading?: number;
    endHeading?: number;
    endTime?: number;
    constantHeading?: number;
  };
}

export interface PedroJsonFile {
  version?: string;
  coordinateSystem?: string;
  paths: PedroJsonPathSegment[];
  pathChain?: {
    paths: PedroJsonPathSegment[];
    headingInterpolation?: PedroJsonPathSegment['headingInterpolation'];
    constraints?: Record<string, number>;
  };
}

function poseFromPoint(p: PedroJsonPoint, heading = 0): Pose {
  return { x: p.x, y: p.y, heading };
}

function headingFromSegment(seg: PedroJsonPathSegment): HeadingInterpolator {
  const hi = seg.headingInterpolation;
  if (!hi) return tangentHeading;
  switch (hi.mode) {
    case 'linear':
      return linearHeading(hi.startHeading ?? 0, hi.endHeading ?? 0, hi.endTime ?? 0.8);
    case 'constant':
      return constantHeading(hi.constantHeading ?? 0);
    default:
      return tangentHeading;
  }
}

export function parsePedroJson(data: PedroJsonFile): PathChain {
  const segments = data.pathChain?.paths ?? data.paths;
  const builder = new PathBuilder();

  for (const seg of segments) {
    let curve;
    if (seg.type === 'BezierLine') {
      const hi = seg.headingInterpolation;
      const startHeading =
        hi?.mode === 'linear' || hi?.mode === 'constant'
          ? (hi.startHeading ?? hi.constantHeading ?? 0)
          : 0;
      const endHeading =
        hi?.mode === 'linear' ? (hi.endHeading ?? startHeading) : startHeading;
      curve = new BezierLine(
        poseFromPoint(seg.startPoint, startHeading),
        poseFromPoint(seg.endPoint, endHeading),
      );
    } else {
      curve = new BezierCurve(
        poseFromPoint(seg.startPoint),
        seg.controlPoint1 ?? seg.startPoint,
        seg.controlPoint2 ?? seg.endPoint,
        poseFromPoint(seg.endPoint),
      );
    }
    const hi = headingFromSegment(seg);
    if (hi !== tangentHeading) {
      const start = seg.startPoint;
      const end = seg.endPoint;
      if (seg.headingInterpolation?.mode === 'linear') {
        builder.setLinearHeadingInterpolation(
          seg.headingInterpolation.startHeading ?? 0,
          seg.headingInterpolation.endHeading ?? Math.atan2(end.y - start.y, end.x - start.x),
          seg.headingInterpolation.endTime ?? 0.8,
        );
      } else if (seg.headingInterpolation?.mode === 'constant') {
        builder.setConstantHeadingInterpolation(seg.headingInterpolation.constantHeading ?? 0);
      }
    } else {
      builder.setTangentHeadingInterpolation();
    }
    builder.addPath(curve);
  }

  return builder.build();
}

export function exportPedroJson(chain: PathChain): PedroJsonFile {
  const paths: PedroJsonPathSegment[] = chain.paths.map((path: Path) => {
    const start = path.curve.getStart();
    const end = path.curve.getEnd();
    if (path.curve instanceof BezierLine) {
      return {
        type: 'BezierLine' as const,
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y },
      };
    }
    const bc = path.curve as BezierCurve;
    return {
      type: 'BezierCurve' as const,
      startPoint: { x: start.x, y: start.y },
      endPoint: { x: end.x, y: end.y },
      controlPoint1: { x: bc.getStart().x, y: bc.getStart().y },
      controlPoint2: { x: bc.getEnd().x, y: bc.getEnd().y },
    };
  });
  return { version: '1.0', coordinateSystem: 'pedro', paths };
}

export function pathChainToPoints(chain: PathChain, samplesPerPath = 50): Pose[] {
  const points: Pose[] = [];
  for (const path of chain.paths) {
    for (let i = 0; i <= samplesPerPath; i++) {
      points.push(path.getPose(i / samplesPerPath));
    }
  }
  return points;
}

export function findSegmentGaps(data: PedroJsonFile): string[] {
  const segments = data.pathChain?.paths ?? data.paths;
  const warnings: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1].endPoint;
    const next = segments[i].startPoint;
    const gap = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (gap > 0.2) {
      warnings.push(
        `Segment ${i + 1} start (${next.x.toFixed(1)}, ${next.y.toFixed(1)}) does not meet segment ${i} end (${prev.x.toFixed(1)}, ${prev.y.toFixed(1)}) — gap ${gap.toFixed(2)} in`,
      );
    }
  }
  return warnings;
}
