import { normalizeAngle, pointInPolygon, type FieldDefinition, type Pose, type Vector2 } from '@ftc-sim/field';
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

/** Safe standoff before creeping into the gate zone (avoids corner wedging). */
const GATE_STANDOFF: Record<Alliance, { x: number; y: number }> = {
  blue: { x: 26, y: 69 },
  red: { x: 118, y: 69 },
};

/** Shallow in-zone point for the gate tap (not the gate lip). */
const GATE_TAP: Record<Alliance, { x: number; y: number }> = {
  blue: { x: 15, y: 69 },
  red: { x: 129, y: 69 },
};

const GATE_ENROUTE_DIST_IN = 48;
const GATE_ENROUTE_AIM_RAD = 0.55;
const GATE_ENROUTE_MIN_SPEED = 4;

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

/** True when an alliance partner is already tasked or driving toward the gate. */
export function allyEnRouteToGate(
  robots: BotRobotSnapshot[],
  alliance: Alliance,
  allyTasks: ReadonlyMap<string, BotTaskKind>,
  excludeRobotId: string,
): boolean {
  const gate = GATE_APPROACH[alliance];
  return robots.some((robot) => {
    if (robot.id === excludeRobotId || robot.alliance !== alliance) return false;
    if (allyTasks.get(robot.id) === 'gate') return true;
    const dist = Math.hypot(gate.x - robot.pose.x, gate.y - robot.pose.y);
    if (dist > GATE_ENROUTE_DIST_IN) return false;
    const speed = Math.hypot(robot.linear.x, robot.linear.y);
    if (speed < GATE_ENROUTE_MIN_SPEED) return false;
    const toGate = Math.atan2(gate.y - robot.pose.y, gate.x - robot.pose.x);
    const velDir = Math.atan2(robot.linear.y, robot.linear.x);
    return Math.abs(normalizeAngle(toGate - velDir)) <= GATE_ENROUTE_AIM_RAD;
  });
}

/** Split near/far launch zones between alliance partners that are scoring. */
export function pickLaunchZoneForScorer(
  robotId: string,
  robots: BotRobotSnapshot[],
  alliance: Alliance,
  allyLaunchZones: ReadonlyMap<string, 'near' | 'far'>,
): 'near' | 'far' {
  const selfZone = allyLaunchZones.get(robotId);
  if (selfZone) return selfZone;

  const used = new Set<'near' | 'far'>();
  for (const robot of robots) {
    if (robot.id === robotId || robot.alliance !== alliance) continue;
    if (robot.stored.length === 0) continue;
    const zone = allyLaunchZones.get(robot.id);
    if (zone) used.add(zone);
  }

  if (!used.has('near')) return 'near';
  if (!used.has('far')) return 'far';
  return robotId.includes('near') ? 'near' : 'far';
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

    let candidates = slots
      .filter((slot) => slot.enabled && !world.humanInputRobotIds.has(slot.robotId))
      .map((slot) => world.robots.find((robot) => robot.id === slot.robotId))
      .filter((robot): robot is BotRobotSnapshot => robot !== undefined && robot.alliance === alliance)
      .filter((robot) => {
        const task = allyTasks.get(robot.id);
        return task !== 'score' || robot.stored.length === 0;
      })
      .sort((a, b) => distToGate(a) - distToGate(b));

    const allyOnGate = candidates.find((robot) => allyTasks.get(robot.id) === 'gate');
    if (allyOnGate) {
      candidates = [allyOnGate];
    } else {
      candidates = candidates.filter(
        (robot) => !allyEnRouteToGate(world.robots, alliance, allyTasks, robot.id),
      );
    }

    const closest = candidates[0];
    if (closest) assignees.add(closest.id);
  }

  return assignees;
}

export function gateApproachPoint(alliance: Alliance): { x: number; y: number } {
  return { ...GATE_APPROACH[alliance] };
}

export function gateStandoffPoint(alliance: Alliance): { x: number; y: number } {
  return { ...GATE_STANDOFF[alliance] };
}

export function gateTapPoint(alliance: Alliance): { x: number; y: number } {
  return { ...GATE_TAP[alliance] };
}

/** Retreat toward own field when wedged on the gate structure. */
export function gateRetreatPoint(pose: Pose, alliance: Alliance): { x: number; y: number } {
  const inset = alliance === 'blue' ? 22 : -22;
  return { x: pose.x + inset, y: pose.y };
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

const PARK_SLOT_OFFSET: Record<string, { dx: number; dy: number }> = {
  'blue-near': { dx: -6, dy: 4 },
  'red-far': { dx: -6, dy: 4 },
  'red-near': { dx: 6, dy: 4 },
};

/** Offset park targets so two alliance bots don't stack on the same base point. */
export function staggeredParkTarget(
  field: FieldDefinition,
  alliance: Alliance,
  robotId: string,
): { target: { x: number; y: number }; heading: number } {
  const base = baseParkTarget(field, alliance);
  const offset = PARK_SLOT_OFFSET[robotId] ?? { dx: 0, dy: 0 };
  return {
    target: { x: base.target.x + offset.dx, y: base.target.y + offset.dy },
    heading: base.heading,
  };
}

export const ENDGAME_NO_NEW_TASKS_SEC = 10;
export const ENDGAME_FORCE_PARK_SEC = 5;

export type EndgameRole = 'finisher' | 'parker';

/** Last 10s: one bot finishes scoring while the partner parks first. */
export function pickEndgameRoles(
  world: BotWorldSnapshot,
  slots: BotSlotConfig[],
  allyTasks: ReadonlyMap<string, BotTaskKind>,
): Map<string, EndgameRole> {
  const roles = new Map<string, EndgameRole>();
  const { match } = world;
  if (
    match.infiniteMode ||
    match.phase !== 'teleop' ||
    match.timeRemainingInPhase > ENDGAME_NO_NEW_TASKS_SEC
  ) {
    return roles;
  }

  for (const alliance of ['blue', 'red'] as Alliance[]) {
    const bots = slots
      .filter((slot) => slot.enabled && !world.humanInputRobotIds.has(slot.robotId))
      .map((slot) => world.robots.find((robot) => robot.id === slot.robotId))
      .filter(
        (robot): robot is BotRobotSnapshot =>
          robot !== undefined && robot.alliance === alliance,
      );

    if (bots.length <= 1) continue;

    const finisherCandidate = [...bots].sort((a, b) => {
      const scoreA =
        a.stored.length * 12 +
        (allyTasks.get(a.id) === 'score' ? 6 : 0) -
        distToBase(a, world.field, alliance) * 0.02;
      const scoreB =
        b.stored.length * 12 +
        (allyTasks.get(b.id) === 'score' ? 6 : 0) -
        distToBase(b, world.field, alliance) * 0.02;
      return scoreB - scoreA;
    })[0]!;

    const canFinish =
      match.timeRemainingInPhase > ENDGAME_FORCE_PARK_SEC &&
      finisherCandidate.stored.length > 0;

    if (canFinish) {
      roles.set(finisherCandidate.id, 'finisher');
      for (const bot of bots) {
        if (bot.id !== finisherCandidate.id) roles.set(bot.id, 'parker');
      }
      continue;
    }

    const byDist = [...bots].sort(
      (a, b) => distToBase(a, world.field, alliance) - distToBase(b, world.field, alliance),
    );
    for (const bot of byDist) {
      roles.set(bot.id, 'parker');
    }
  }

  return roles;
}

function distToBase(
  robot: BotRobotSnapshot,
  field: FieldDefinition,
  alliance: Alliance,
): number {
  const base = baseParkTarget(field, alliance);
  return Math.hypot(base.target.x - robot.pose.x, base.target.y - robot.pose.y);
}

/** Opponent robot inside our alliance secret-tunnel zone (yield, don't challenge). */
export function opponentInOurSecretTunnel(
  robots: BotRobotSnapshot[],
  alliance: Alliance,
  field: FieldDefinition,
): boolean {
  const zone = field.zones.find(
    (z) => z.type === 'secret_tunnel' && z.alliance === alliance,
  );
  if (!zone || zone.polygon.length < 3) return false;
  return robots.some(
    (robot) =>
      robot.alliance !== alliance &&
      pointInPolygon({ x: robot.pose.x, y: robot.pose.y }, zone.polygon),
  );
}

/** True when driving into the opponent gate zone without gate assignment. */
export function shouldAvoidOpponentGateZone(
  pose: Vector2,
  alliance: Alliance,
  task: BotTaskKind,
  gateAssignees: ReadonlySet<string>,
  robotId: string,
): boolean {
  if (task === 'gate' || gateAssignees.has(robotId)) return false;
  return distToOpponentGate(pose, alliance) < 26;
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
