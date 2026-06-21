import type { FieldDefinition, Pose, Vector2 } from '@ftc-sim/field';
import { evaluateBaseReturn } from '@ftc-sim/game-decode';
import type { Alliance } from '@ftc-sim/game-decode';
import { robotFootprintCorners } from '@ftc-sim/mechanisms';
import type { RobotFootprint } from '@ftc-sim/robot';
import type { BotRobotSnapshot, BotSlotConfig, BotTaskKind, BotWorldSnapshot } from './types.js';

const RAMP_FULL_SLOTS = 6;

const GATE_APPROACH: Record<Alliance, { x: number; y: number }> = {
  blue: { x: 9, y: 69 },
  red: { x: 135, y: 69 },
};

/** Artifact centers inside this radius require driving into the opponent gate zone to intake. */
export const OPPONENT_GATE_ARTIFACT_EXCLUDE_IN = 20;
/** Score penalty fades from full at exclude radius out to this distance. */
export const OPPONENT_GATE_ARTIFACT_PENALTY_IN = 36;
export const OPPONENT_GATE_COLLECT_REPEL_RADIUS = 42;
export const OPPONENT_GATE_COLLECT_REPEL_STRENGTH = 58;

const FALLBACK_BASE: Record<Alliance, { target: { x: number; y: number }; heading: number }> = {
  blue: { target: { x: 105, y: 33 }, heading: Math.PI / 2 },
  red: { target: { x: 33, y: 33 }, heading: Math.PI / 2 },
};

export function rampFilledCount(world: BotWorldSnapshot, alliance: Alliance): number {
  const ramp = world.gameState?.rampOccupancy[alliance];
  if (!ramp) return 0;
  return ramp.filter((slot) => slot !== null).length;
}

export function isRampFull(world: BotWorldSnapshot, alliance: Alliance): boolean {
  return rampFilledCount(world, alliance) >= RAMP_FULL_SLOTS;
}

export function isGateOpen(world: BotWorldSnapshot, alliance: Alliance): boolean {
  return world.gameState?.gateOpen[alliance] ?? false;
}

function distToGate(robot: BotRobotSnapshot): number {
  const gate = GATE_APPROACH[robot.alliance];
  return Math.hypot(gate.x - robot.pose.x, gate.y - robot.pose.y);
}

function allyBusyScoring(
  robots: BotRobotSnapshot[],
  alliance: Alliance,
  allyTasks: ReadonlyMap<string, BotTaskKind>,
): boolean {
  return robots.some(
    (robot) =>
      robot.alliance === alliance &&
      robot.stored.length > 0 &&
      (allyTasks.get(robot.id) === 'score' || robot.stored.length >= 3),
  );
}

export function pickGateAssignees(
  world: BotWorldSnapshot,
  slots: BotSlotConfig[],
  allyTasks: ReadonlyMap<string, BotTaskKind>,
  teleopTimeRemainingSec?: number,
): Set<string> {
  if (
    teleopTimeRemainingSec !== undefined &&
    !world.match.infiniteMode &&
    world.match.phase === 'teleop' &&
    teleopTimeRemainingSec <= 10
  ) {
    return new Set();
  }

  const assignees = new Set<string>();
  const alliances: Alliance[] = ['blue', 'red'];

  for (const alliance of alliances) {
    if (!isRampFull(world, alliance) || isGateOpen(world, alliance)) continue;
    if (allyBusyScoring(world.robots, alliance, allyTasks)) continue;

    const candidates = slots
      .filter((slot) => slot.enabled && !world.humanInputRobotIds.has(slot.robotId))
      .map((slot) => world.robots.find((robot) => robot.id === slot.robotId))
      .filter((robot): robot is BotRobotSnapshot => robot !== undefined && robot.alliance === alliance)
      .filter((robot) => {
        const task = allyTasks.get(robot.id);
        return task !== 'score' || robot.stored.length === 0;
      })
      .sort((a, b) => distToGate(a) - distToGate(b));

    const closest = candidates[0];
    if (closest) assignees.add(closest.id);
  }

  return assignees;
}

export function gateApproachPoint(alliance: Alliance): { x: number; y: number } {
  return { ...GATE_APPROACH[alliance] };
}

export function opponentGatePoint(alliance: Alliance): Vector2 {
  const opponent: Alliance = alliance === 'blue' ? 'red' : 'blue';
  return { ...GATE_APPROACH[opponent] };
}

export function distToOpponentGate(pose: Vector2, alliance: Alliance): number {
  const gate = opponentGatePoint(alliance);
  return Math.hypot(pose.x - gate.x, pose.y - gate.y);
}

export function artifactTooCloseToOpponentGate(pose: Vector2, alliance: Alliance): boolean {
  return distToOpponentGate(pose, alliance) < OPPONENT_GATE_ARTIFACT_EXCLUDE_IN;
}

/** Park target from field base_zone polygon centroid (not launch zone). */
export function baseParkTarget(
  field: FieldDefinition,
  alliance: Alliance,
): { target: { x: number; y: number }; heading: number } {
  const zone = field.zones.find((z) => z.type === 'base_zone' && z.alliance === alliance);
  if (!zone || zone.polygon.length === 0) {
    return FALLBACK_BASE[alliance];
  }
  let sx = 0;
  let sy = 0;
  for (const p of zone.polygon) {
    sx += p.x;
    sy += p.y;
  }
  return {
    target: { x: sx / zone.polygon.length, y: sy / zone.polygon.length },
    heading: Math.PI / 2,
  };
}

export function opponentBaseCentroid(
  field: FieldDefinition,
  alliance: Alliance,
): Vector2 | null {
  const opponent: Alliance = alliance === 'blue' ? 'red' : 'blue';
  const zone = field.zones.find((z) => z.type === 'base_zone' && z.alliance === opponent);
  if (!zone || zone.polygon.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const p of zone.polygon) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / zone.polygon.length, y: sy / zone.polygon.length };
}

export function parkReturnStatus(
  pose: Pose,
  footprint: RobotFootprint,
  field: FieldDefinition,
  alliance: Alliance,
): 'none' | 'partial' | 'full' {
  const zone = field.zones.find((z) => z.type === 'base_zone' && z.alliance === alliance);
  if (!zone) return 'none';
  return evaluateBaseReturn(robotFootprintCorners(pose, footprint), zone.polygon);
}

/** @deprecated use baseParkTarget(field, alliance) */
export const BASE_APPROACH = FALLBACK_BASE;
