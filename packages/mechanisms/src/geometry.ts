import type { FieldDefinition, FieldZoneDefinition, Pose, Vector2 } from '@ftc-sim/field';
import { pointInPolygon } from '@ftc-sim/field';
import type { RobotFootprint } from '@ftc-sim/robot';
import { buildObb, obbPenetratingPolygon, robotCorners } from '@ftc-sim/robot';
import type { Alliance, ArtifactColor } from '@ftc-sim/game-decode';
import { ARTIFACT_RADIUS_IN } from '@ftc-sim/game-decode';

export const GRAVITY_INCHES_PER_S2 = 386.09;
export const MIN_SHOT_SPEED_IN_S = 55;
export const MAX_SHOT_SPEED_IN_S = 165;
export const SHOT_SPEED_PER_INCH = 0.95;
export const SHOT_SPEED_BASE = 30;
export const OVERFLOW_SOUTH_VELOCITY = 18;
export const GATE_RELEASE_SOUTH_VELOCITY = 26;
export const GATE_RELEASE_INTERVAL_S = 0.12;
export const RAMP_ROLL_DURATION_S = 0.9;
export const RAMP_BOTTOM_Y = 70;
export const RAMP_STACK_DIAMETER = ARTIFACT_RADIUS_IN * 2;

export interface Segment {
  a: Vector2;
  b: Vector2;
}

export function frontEdgeSegment(pose: Pose, footprint: RobotFootprint): Segment {
  const corners = robotCorners(pose, footprint);
  return { a: corners[0]!, b: corners[1]! };
}

export function frontEdgeCenter(pose: Pose, footprint: RobotFootprint): Vector2 {
  const edge = frontEdgeSegment(pose, footprint);
  return { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
}

export function distancePointToSegment(point: Vector2, seg: Segment): number {
  const abx = seg.b.x - seg.a.x;
  const aby = seg.b.y - seg.a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return Math.hypot(point.x - seg.a.x, point.y - seg.a.y);
  let t = ((point.x - seg.a.x) * abx + (point.y - seg.a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = seg.a.x + t * abx;
  const py = seg.a.y + t * aby;
  return Math.hypot(point.x - px, point.y - py);
}

export function artifactTouchesFrontEdge(
  artifactCenter: Vector2,
  pose: Pose,
  footprint: RobotFootprint,
  radius = ARTIFACT_RADIUS_IN,
  epsilon = 0.35,
): boolean {
  const edge = frontEdgeSegment(pose, footprint);
  return distancePointToSegment(artifactCenter, edge) <= radius + epsilon;
}

export function robotInLaunchZone(
  pose: Pose,
  footprint: RobotFootprint,
  field: FieldDefinition,
): boolean {
  const launchZones = field.zones.filter((z) => z.type === 'launch_zone');
  const corners = robotCorners(pose, footprint);
  const samples: Vector2[] = [...corners, { x: pose.x, y: pose.y }];
  return samples.some((point) => launchZones.some((zone) => pointInPolygon(point, zone.polygon)));
}

export function getZoneByType(
  field: FieldDefinition,
  type: FieldZoneDefinition['type'],
  alliance?: Alliance,
): FieldZoneDefinition | undefined {
  return field.zones.find(
    (z) => z.type === type && (alliance === undefined || z.alliance === alliance),
  );
}

/** Nine ramp slots stacked bottom→top (south→north), balls touching (5″ diameter). */
export function rampSlotPositions(alliance: Alliance): Vector2[] {
  const centerX = alliance === 'blue' ? 3 : 141;
  const bottomCenterY = RAMP_BOTTOM_Y + ARTIFACT_RADIUS_IN;
  return Array.from({ length: 9 }, (_, i) => ({
    x: centerX,
    y: bottomCenterY + i * RAMP_STACK_DIAMETER,
  }));
}

/** South exit at bottom center of ramp (balls roll south off the ramp). */
export function rampSouthExitPose(alliance: Alliance): Pose {
  const centerX = alliance === 'blue' ? 3 : 141;
  return { x: centerX, y: RAMP_BOTTOM_Y - ARTIFACT_RADIUS_IN, heading: 0 };
}

export function overflowSpawnPose(alliance: Alliance): Pose {
  return rampSouthExitPose(alliance);
}

/** Gate release rolls south like overflow, slightly faster. */
export function gateReleaseVelocity(): Vector2 {
  return { x: 0, y: -GATE_RELEASE_SOUTH_VELOCITY };
}

/** @deprecated use rampSouthExitPose */
export function rampOutwardSpawnPose(alliance: Alliance, _slotY?: number): Pose {
  return rampSouthExitPose(alliance);
}

function polygonCentroid(polygon: Vector2[]): Vector2 {
  if (polygon.length === 0) return { x: 72, y: 130 };
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

/** Straight-line shot: speed scales with distance to goal basin centroid. */
export function planShotDistanceSpeed(
  distanceInches: number,
): number {
  return Math.min(
    MAX_SHOT_SPEED_IN_S,
    Math.max(MIN_SHOT_SPEED_IN_S, SHOT_SPEED_BASE + distanceInches * SHOT_SPEED_PER_INCH),
  );
}

export function buildStraightTrajectory(
  start: Vector2,
  direction: Vector2,
  speedInchesPerSec: number,
  dt: number,
  maxDistanceInches: number,
): TrajectorySample[] {
  const len = Math.hypot(direction.x, direction.y) || 1;
  const dir = { x: direction.x / len, y: direction.y / len };
  const totalTime = maxDistanceInches / Math.max(speedInchesPerSec, 1);
  const samples: TrajectorySample[] = [{ t: 0, position: { ...start } }];
  for (let step = 1; step * dt <= totalTime + 1e-6; step++) {
    const t = step * dt;
    samples.push({
      t,
      position: {
        x: start.x + dir.x * speedInchesPerSec * t,
        y: start.y + dir.y * speedInchesPerSec * t,
      },
    });
  }
  return samples;
}

export function humanPlayerRespawnPose(alliance: Alliance, slotIndex: number): Pose {
  const slots = humanPlayerAllDepotPositions(alliance);
  const slot = slots[slotIndex % slots.length]!;
  return { x: slot.x, y: slot.y, heading: 0 };
}

/** Three loading-zone slots (always on field edge; teleop intake). */
export function humanPlayerStationPositions(alliance: Alliance): Vector2[] {
  const x = alliance === 'blue' ? 5 : 144 - 5;
  return [5, 10, 15].map((y) => ({ x, y }));
}

/** Six reserve slots outside the field (teleop human-player feed). */
export function humanPlayerReservePositions(alliance: Alliance): Vector2[] {
  const xs = alliance === 'blue' ? [2, 8] : [144 - 2, 144 - 8];
  const ys = [4, 10, 16];
  const out: Vector2[] = [];
  for (const x of xs) {
    for (const y of ys) {
      out.push({ x, y });
    }
  }
  return out;
}

export function humanPlayerAllDepotPositions(alliance: Alliance): Vector2[] {
  return [...humanPlayerReservePositions(alliance), ...humanPlayerStationPositions(alliance)];
}

/** @deprecated use humanPlayerAllDepotPositions */
export function humanPlayerSlotPositions(alliance: Alliance): Vector2[] {
  return humanPlayerAllDepotPositions(alliance);
}

export function robotForwardUnit(pose: Pose): Vector2 {
  return { x: Math.cos(pose.heading), y: Math.sin(pose.heading) };
}

export function isOutOfFieldBounds(point: Vector2, margin = 0): boolean {
  return (
    point.x < -margin ||
    point.x > 144 + margin ||
    point.y < -margin ||
    point.y > 144 + margin
  );
}

export interface TrajectorySample {
  t: number;
  position: Vector2;
}

export interface ShotPlan {
  launchPoint: Vector2;
  initialVelocity: Vector2;
  trajectory: TrajectorySample[];
  timeOfFlight: number;
  targetBasin: Alliance;
  distanceToGoal: number;
  shotSpeed: number;
}

export function simulateTrajectory(
  start: Vector2,
  velocity: Vector2,
  dt: number,
  maxSteps: number,
): TrajectorySample[] {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < 1e-6) return [{ t: 0, position: { ...start } }];
  const direction = { x: velocity.x / speed, y: velocity.y / speed };
  return buildStraightTrajectory(start, direction, speed, dt, speed * maxSteps * dt);
}

export function planShot(
  robotPose: Pose,
  robotVelocity: Vector2,
  footprint: RobotFootprint,
  field: FieldDefinition,
  robotAlliance: Alliance,
): ShotPlan {
  const launchPoint = frontEdgeCenter(robotPose, footprint);
  const targetBasin = robotAlliance;
  const basin = getZoneByType(field, 'goal_basin', targetBasin);
  const basinPoly = basin?.polygon ?? [];
  const target = polygonCentroid(basinPoly);
  const distance = Math.hypot(target.x - launchPoint.x, target.y - launchPoint.y);
  const speed = planShotDistanceSpeed(distance);
  const dir = robotForwardUnit(robotPose);
  const dt = 1 / 120;
  const maxDistance = distance + 24;
  const trajectory = buildStraightTrajectory(launchPoint, dir, speed, dt, maxDistance);
  const initialVelocity = {
    x: robotVelocity.x + dir.x * speed,
    y: robotVelocity.y + dir.y * speed,
  };
  const timeOfFlight = trajectory[trajectory.length - 1]?.t ?? 0;
  return {
    launchPoint,
    initialVelocity,
    trajectory,
    timeOfFlight,
    targetBasin,
    distanceToGoal: distance,
    shotSpeed: speed,
  };
}

export function sampleTrajectoryAt(
  trajectory: TrajectorySample[],
  elapsed: number,
): Vector2 {
  if (trajectory.length === 0) return { x: 0, y: 0 };
  if (elapsed <= 0) return { ...trajectory[0]!.position };
  for (let i = 1; i < trajectory.length; i++) {
    const prev = trajectory[i - 1]!;
    const next = trajectory[i]!;
    if (elapsed <= next.t) {
      const u = (elapsed - prev.t) / Math.max(next.t - prev.t, 1e-6);
      return {
        x: prev.position.x + (next.position.x - prev.position.x) * u,
        y: prev.position.y + (next.position.y - prev.position.y) * u,
      };
    }
  }
  return { ...trajectory[trajectory.length - 1]!.position };
}

export function findBasinAtPoint(
  point: Vector2,
  field: FieldDefinition,
): { alliance: Alliance; zone: FieldZoneDefinition } | null {
  for (const alliance of ['blue', 'red'] as const) {
    const zone = getZoneByType(field, 'goal_basin', alliance);
    if (zone && pointInPolygon(point, zone.polygon)) {
      return { alliance, zone };
    }
  }
  return null;
}

export function heldArtifactOffset(slotIndex: number, _footprint: RobotFootprint): Vector2 {
  /** Slot 0 = back, 1 = center, 2 = front along robot +X forward axis. */
  const forwardOffsets = [-5, 0, 5];
  return { x: forwardOffsets[slotIndex] ?? 0, y: 0 };
}

export function localToWorld(local: Vector2, pose: Pose): Vector2 {
  const cos = Math.cos(pose.heading);
  const sin = Math.sin(pose.heading);
  return {
    x: pose.x + local.x * cos - local.y * sin,
    y: pose.y + local.x * sin + local.y * cos,
  };
}

/** Robot footprint corners in field space (for gate debug overlay). */
export function robotFootprintCorners(pose: Pose, footprint: RobotFootprint): Vector2[] {
  return robotCorners(pose, footprint);
}

/** True when the robot OBB overlaps the gate zone polygon. */
export function robotInGateZone(
  pose: Pose,
  footprint: RobotFootprint,
  gatePolygon: Vector2[],
): boolean {
  return obbPenetratingPolygon(buildObb(pose, footprint), gatePolygon);
}

export type ArtifactStuckKind = 'goal_barrier' | 'ramp';

/** Detect artifacts clipping through goal walls or stuck inside the ramp column. */
export function detectArtifactStuckInStructure(
  field: FieldDefinition,
  point: Vector2,
): { kind: ArtifactStuckKind; alliance: Alliance } | null {
  for (const alliance of ['blue', 'red'] as const) {
    const ramp = getZoneByType(field, 'ramp', alliance);
    if (!ramp) continue;
    if (!pointInPolygon(point, ramp.polygon)) continue;
    if (point.y >= RAMP_BOTTOM_Y - ARTIFACT_RADIUS_IN) {
      return { kind: 'ramp', alliance };
    }
  }

  for (const alliance of ['blue', 'red'] as const) {
    const body = field.bodies.find((b) => b.id === `${alliance}_goal`);
    if (body?.vertices && pointInPolygon(point, body.vertices)) {
      return { kind: 'goal_barrier', alliance };
    }
  }

  return null;
}

export type { ArtifactColor };
