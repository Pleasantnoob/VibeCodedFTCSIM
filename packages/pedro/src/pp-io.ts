import { VISUAL_FIELD_SIZE_INCHES, FIELD_SIZE_INCHES } from '@ftc-sim/field';
import type { Pose, Vector2 } from '@ftc-sim/field';
import type { AutoSequence, AutoSequenceStep } from './auto-sequence.js';
import { BezierCurve, BezierLine } from './geometry.js';
import {
  constantHeading,
  linearHeading,
  PathBuilder,
  PathChain,
  getPathStartPose,
  tangentHeading,
} from './paths.js';

/** Visualizer canvas inches (0–141.5) → Pedro inches (0–144). */
export const VISUALIZER_TO_PEDRO = FIELD_SIZE_INCHES / VISUAL_FIELD_SIZE_INCHES;

export interface VisualizerPoint {
  x: number;
  y: number;
  locked?: boolean;
  heading?: 'linear' | 'constant' | 'tangential' | 'tangent';
  startDeg?: number;
  endDeg?: number;
  degrees?: number;
  reverse?: boolean;
}

export interface VisualizerControlPoint {
  x: number;
  y: number;
  locked?: boolean;
}

export interface VisualizerLine {
  id?: string;
  endPoint: VisualizerPoint;
  controlPoints: VisualizerControlPoint[];
  color?: string;
  name?: string;
  waitBeforeMs?: number;
  waitAfterMs?: number;
  waitBeforeName?: string;
  waitAfterName?: string;
}

export interface VisualizerSequencePathItem {
  kind: 'path';
  lineId: string;
}

export interface VisualizerSequenceWaitItem {
  kind: 'wait';
  id?: string;
  name?: string;
  durationMs: number;
}

export type VisualizerSequenceItem = VisualizerSequencePathItem | VisualizerSequenceWaitItem;

export interface VisualizerPpFile {
  startPoint: VisualizerPoint;
  lines: VisualizerLine[];
  shapes?: unknown[];
  sequence?: VisualizerSequenceItem[];
  pathChains?: unknown[];
  version?: string;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function usesPedroInches(data: VisualizerPpFile): boolean {
  const version = parseFloat(String(data.version ?? '0'));
  return Number.isFinite(version) && version >= 1.2;
}

function toPedroIn(value: number, data: VisualizerPpFile): number {
  return usesPedroInches(data) ? value : value * VISUALIZER_TO_PEDRO;
}

function toPedroPoint(p: { x: number; y: number }, data: VisualizerPpFile): Vector2 {
  return { x: toPedroIn(p.x, data), y: toPedroIn(p.y, data) };
}

function applyHeading(builder: PathBuilder, point: VisualizerPoint): void {
  if (point.heading === 'linear') {
    builder.setLinearHeadingInterpolation(
      degToRad(point.startDeg ?? 0),
      degToRad(point.endDeg ?? 0),
    );
  } else if (point.heading === 'constant') {
    builder.setConstantHeadingInterpolation(degToRad(point.degrees ?? 0));
  } else {
    builder.setTangentHeadingInterpolation();
  }
}

function lineEndpointHeadings(
  point: VisualizerPoint,
  fallbackStartDeg: number,
): { start: number; end: number } {
  if (point.heading === 'linear') {
    return {
      start: degToRad(point.startDeg ?? fallbackStartDeg),
      end: degToRad(point.endDeg ?? point.startDeg ?? fallbackStartDeg),
    };
  }
  if (point.heading === 'constant') {
    const heading = degToRad(point.degrees ?? fallbackStartDeg);
    return { start: heading, end: heading };
  }
  return { start: 0, end: 0 };
}

function poseFromVisualizer(
  p: { x: number; y: number },
  data: VisualizerPpFile,
  heading = 0,
): Pose {
  const pt = toPedroPoint(p, data);
  return { x: pt.x, y: pt.y, heading };
}

function msToSec(ms: unknown): number {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / 1000;
}

function isSequencePathItem(item: unknown): item is VisualizerSequencePathItem {
  return (
    !!item &&
    typeof item === 'object' &&
    (item as VisualizerSequencePathItem).kind === 'path' &&
    typeof (item as VisualizerSequencePathItem).lineId === 'string'
  );
}

function isSequenceWaitItem(item: unknown): item is VisualizerSequenceWaitItem {
  return (
    !!item &&
    typeof item === 'object' &&
    (item as VisualizerSequenceWaitItem).kind === 'wait'
  );
}

function addLineToBuilder(
  builder: PathBuilder,
  prevEnd: Vector2,
  line: VisualizerLine,
  data: VisualizerPpFile,
  fallbackStartDeg: number,
): Vector2 {
  const end = toPedroPoint(line.endPoint, data);
  applyHeading(builder, line.endPoint);
  const { start: startHeading, end: endHeading } = lineEndpointHeadings(
    line.endPoint,
    fallbackStartDeg,
  );

  if (line.controlPoints.length === 0) {
    builder.addPath(
      new BezierLine(
        { x: prevEnd.x, y: prevEnd.y, heading: startHeading },
        { x: end.x, y: end.y, heading: endHeading },
      ),
    );
  } else if (line.controlPoints.length >= 2) {
    builder.addPath(
      new BezierCurve(
        poseFromVisualizer(prevEnd, data, startHeading),
        toPedroPoint(line.controlPoints[0], data),
        toPedroPoint(line.controlPoints[1], data),
        poseFromVisualizer(end, data, endHeading),
      ),
    );
  } else {
    const cp = toPedroPoint(line.controlPoints[0], data);
    builder.addPath(
      new BezierCurve(
        poseFromVisualizer(prevEnd, data, startHeading),
        cp,
        cp,
        poseFromVisualizer(end, data, endHeading),
      ),
    );
  }

  return end;
}

function buildLineSegment(
  prevEnd: Vector2,
  line: VisualizerLine,
  data: VisualizerPpFile,
  fallbackStartDeg: number,
): { chain: PathChain; end: Vector2 } {
  const builder = new PathBuilder();
  const end = addLineToBuilder(builder, prevEnd, line, data, fallbackStartDeg);
  return { chain: builder.build(), end };
}

function pushWait(steps: AutoSequenceStep[], durationMs: unknown, name?: string): void {
  const durationSec = msToSec(durationMs);
  if (durationSec <= 0) return;
  steps.push({ kind: 'wait', durationSec, name });
}

export function parseVisualizerPp(data: VisualizerPpFile): PathChain {
  if (!data.startPoint || !Array.isArray(data.lines)) {
    throw new Error('Invalid Visualizer .pp file: expected startPoint and lines[]');
  }

  const builder = new PathBuilder();
  let prevEnd = toPedroPoint(data.startPoint, data);
  const spawnStartDeg = data.startPoint.startDeg ?? data.startPoint.degrees ?? 0;

  for (const line of data.lines) {
    prevEnd = addLineToBuilder(builder, prevEnd, line, data, spawnStartDeg);
  }

  return builder.build();
}

export function parseVisualizerAutoSequence(data: VisualizerPpFile): AutoSequence {
  const displayChain = parseVisualizerPp(data);
  const startPose = getPathStartPose(displayChain);
  const spawnStartDeg = data.startPoint.startDeg ?? data.startPoint.degrees ?? 0;

  const lineById = new Map<string, VisualizerLine>();
  for (const line of data.lines) {
    const id = line.id ?? `line-${lineById.size}`;
    lineById.set(id, line);
  }

  const rawSequence: VisualizerSequenceItem[] =
    data.sequence && data.sequence.length > 0
      ? data.sequence.filter(
          (item): item is VisualizerSequenceItem =>
            isSequencePathItem(item) || isSequenceWaitItem(item),
        )
      : data.lines.map((line, index) => ({
          kind: 'path' as const,
          lineId: line.id ?? `line-${index}`,
        }));

  const steps: AutoSequenceStep[] = [];
  let prevEnd = toPedroPoint(data.startPoint, data);

  for (const item of rawSequence) {
    if (item.kind === 'wait') {
      pushWait(steps, item.durationMs, item.name);
      continue;
    }

    const line = lineById.get(item.lineId);
    if (!line) continue;

    pushWait(steps, line.waitBeforeMs, line.waitBeforeName);
    const segment = buildLineSegment(prevEnd, line, data, spawnStartDeg);
    steps.push({ kind: 'path', chain: segment.chain });
    prevEnd = segment.end;
    pushWait(steps, line.waitAfterMs, line.waitAfterName);
  }

  return { displayChain, steps, startPose };
}
