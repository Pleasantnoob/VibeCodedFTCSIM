import {
  distToOpponentGate,
  gateApproachPoint,
  opponentGoalWallRepulsion,
  opponentInOurSecretTunnel,
  OPPONENT_GATE_ARTIFACT_PENALTY_IN,
  OPPONENT_GATE_AVOID_RADIUS,
  OPPONENT_GATE_AVOID_STRENGTH,
  OPPONENT_GATE_COLLECT_REPEL_RADIUS,
  OPPONENT_GATE_COLLECT_REPEL_STRENGTH,
  opponentGatePoint,
  shouldAvoidOpponentGateZone,
} from '../coordination.js';
import { pointInPolygon, type FieldDefinition, type Pose, type Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { DriveFrame, HolonomicInput } from '@ftc-sim/robot';
import type { BotRobotSnapshot, BotTaskKind } from '../types.js';
import { parkPassVerticalSide } from './park-navigation.js';

const MAX_V = 48;
const ROBOT_RADIUS = 14;
const SEPARATION_RANGE_IN = 52;
const MIN_SEP_DIST = ROBOT_RADIUS * 2.15;

const GOAL_WALL_AVOID: Record<Alliance, { x: number; y0: number; y1: number }> = {
  blue: { x: 8, y0: 66, y1: 122 },
  red: { x: 136, y0: 66, y1: 122 },
};

function inputToFieldVel(
  input: HolonomicInput,
  heading: number,
  driveFrame: DriveFrame,
): Vector2 {
  const fwd = (input.forward ?? 0) * MAX_V;
  const str = (input.strafe ?? 0) * MAX_V;
  if (driveFrame === 'field') {
    return { x: -str, y: fwd };
  }
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    x: fwd * cos - str * sin,
    y: fwd * sin + str * cos,
  };
}

function fieldVelToInput(
  input: HolonomicInput,
  vel: Vector2,
  heading: number,
  driveFrame: DriveFrame,
): HolonomicInput {
  if (driveFrame === 'field') {
    return {
      ...input,
      forward: Math.max(-1, Math.min(1, vel.y / MAX_V)),
      strafe: Math.max(-1, Math.min(1, -vel.x / MAX_V)),
    };
  }
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const fwd = vel.x * cos + vel.y * sin;
  const str = -vel.x * sin + vel.y * cos;
  return {
    ...input,
    forward: Math.max(-1, Math.min(1, fwd / MAX_V)),
    strafe: Math.max(-1, Math.min(1, str / MAX_V)),
  };
}

function repulsionFromPoint(pose: Pose, point: Vector2, radius: number, strength: number): Vector2 {
  const dx = pose.x - point.x;
  const dy = pose.y - point.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= radius || dist < 0.5) return { x: 0, y: 0 };
  const push = strength * (1 - dist / radius);
  return { x: (dx / dist) * push, y: (dy / dist) * push };
}

function secretTunnelZone(field: FieldDefinition, tunnelAlliance: Alliance) {
  return field.zones.find(
    (z) => z.type === 'secret_tunnel' && z.alliance === tunnelAlliance,
  );
}

function zoneCentroid(zone: { polygon: Vector2[] }): Vector2 {
  let cx = 0;
  let cy = 0;
  for (const p of zone.polygon) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / zone.polygon.length, y: cy / zone.polygon.length };
}

/** Opponent robot inside their own secret-tunnel zone (foul risk if we contact them). */
function opponentInSecretTunnel(
  robots: BotRobotSnapshot[],
  selfAlliance: Alliance,
  field: FieldDefinition,
): boolean {
  const opponent: Alliance = selfAlliance === 'blue' ? 'red' : 'blue';
  const zone = secretTunnelZone(field, opponent);
  if (!zone || zone.polygon.length < 3) return false;
  return robots.some(
    (robot) =>
      robot.alliance === opponent &&
      pointInPolygon({ x: robot.pose.x, y: robot.pose.y }, zone.polygon),
  );
}

function secretTunnelRepulsion(
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfAlliance: Alliance,
  field: FieldDefinition,
): Vector2 {
  const opponent: Alliance = selfAlliance === 'blue' ? 'red' : 'blue';
  const zone = secretTunnelZone(field, opponent);
  if (!zone || zone.polygon.length < 3) return { x: 0, y: 0 };

  let vx = 0;
  let vy = 0;
  for (const robot of robots) {
    if (robot.alliance !== opponent) continue;
    if (!pointInPolygon({ x: robot.pose.x, y: robot.pose.y }, zone.polygon)) continue;
    const personal = repulsionFromPoint(pose, robot.pose, 72, 110);
    vx += personal.x;
    vy += personal.y;
  }
  if (vx !== 0 || vy !== 0) {
    const centroid = zoneCentroid(zone);
    const zoneRep = repulsionFromPoint(pose, centroid, 58, 72);
    vx += zoneRep.x;
    vy += zoneRep.y;
  }
  return { x: vx, y: vy };
}

function opponentBaseRepulsion(
  pose: Pose,
  alliance: Alliance,
  field: FieldDefinition,
  task: BotTaskKind,
): Vector2 {
  if (task !== 'park' && task !== 'collect' && task !== 'score') return { x: 0, y: 0 };
  const opponent: Alliance = alliance === 'blue' ? 'red' : 'blue';
  const zone = field.zones.find((z) => z.type === 'base_zone' && z.alliance === opponent);
  if (!zone || zone.polygon.length === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  for (const p of zone.polygon) {
    cx += p.x;
    cy += p.y;
  }
  cx /= zone.polygon.length;
  cy /= zone.polygon.length;
  const strength = task === 'park' ? 52 : 28;
  const radius = task === 'park' ? 48 : 32;
  return repulsionFromPoint(pose, { x: cx, y: cy }, radius, strength);
}

function goalWallRepulsion(pose: Pose, alliance: Alliance): Vector2 {
  const wall = GOAL_WALL_AVOID[alliance];
  if (pose.y < wall.y0 || pose.y > wall.y1) return { x: 0, y: 0 };
  const dist = Math.abs(pose.x - wall.x);
  if (dist > 14) return { x: 0, y: 0 };
  const pushX = alliance === 'blue' ? 1 : -1;
  return { x: pushX * (14 - dist) * 0.4, y: 0 };
}

function allyShootingSpaceRepulsion(
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  selfTask: BotTaskKind,
  allyTasks: ReadonlyMap<string, BotTaskKind> | undefined,
): Vector2 {
  if (!allyTasks) return { x: 0, y: 0 };
  let vx = 0;
  let vy = 0;
  for (const other of robots) {
    if (other.id === selfId || other.alliance !== selfAlliance) continue;
    const allyTask = allyTasks.get(other.id);
    const allyShooting = allyTask === 'score' && other.stored.length > 0;
    if (!allyShooting) continue;
    if (selfTask === 'score' && other.stored.length > 0) continue;
    const rep = repulsionFromPoint(pose, other.pose, 44, 38);
    vx += rep.x;
    vy += rep.y;
    if (selfTask !== 'score') {
      const extra = repulsionFromPoint(pose, other.pose, 56, 18);
      vx += extra.x;
      vy += extra.y;
    }
  }
  return { x: vx, y: vy };
}

function allyGateLaneRepulsion(
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  selfTask: BotTaskKind,
  allyTasks: ReadonlyMap<string, BotTaskKind> | undefined,
  gateAssignees: ReadonlySet<string> | undefined,
): Vector2 {
  if (!allyTasks || selfTask === 'gate') return { x: 0, y: 0 };
  const gate = gateApproachPoint(selfAlliance);
  let vx = 0;
  let vy = 0;
  for (const other of robots) {
    if (other.id === selfId || other.alliance !== selfAlliance) continue;
    const allyTask = allyTasks.get(other.id);
    const allyOnGate =
      allyTask === 'gate' ||
      gateAssignees?.has(other.id) === true;
    if (!allyOnGate) continue;
    const rep = repulsionFromPoint(pose, gate, 52, selfTask === 'collect' ? 42 : 28);
    vx += rep.x;
    vy += rep.y;
    const personal = repulsionFromPoint(pose, other.pose, 40, 24);
    vx += personal.x;
    vy += personal.y;
  }
  return { x: vx, y: vy };
}

function ourSecretTunnelRepulsion(
  pose: Pose,
  alliance: Alliance,
  field: FieldDefinition,
): Vector2 {
  const zone = field.zones.find(
    (z) => z.type === 'secret_tunnel' && z.alliance === alliance,
  );
  if (!zone || zone.polygon.length < 3) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  for (const p of zone.polygon) {
    cx += p.x;
    cy += p.y;
  }
  cx /= zone.polygon.length;
  cy /= zone.polygon.length;
  return repulsionFromPoint(pose, { x: cx, y: cy }, 36, 36);
}

function allyParkRepulsion(
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  selfTask: BotTaskKind,
  allyTasks: ReadonlyMap<string, BotTaskKind> | undefined,
): Vector2 {
  if (selfTask !== 'park' || !allyTasks) return { x: 0, y: 0 };
  let vx = 0;
  let vy = 0;
  for (const other of robots) {
    if (other.id === selfId || other.alliance !== selfAlliance) continue;
    if (allyTasks.get(other.id) !== 'park') continue;
    const rep = repulsionFromPoint(pose, other.pose, 48, 46);
    vx += rep.x;
    vy += rep.y;
  }
  return { x: vx, y: vy };
}

function applyRobotSeparation(
  vel: Vector2,
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  selfTask: BotTaskKind,
  allyTasks: ReadonlyMap<string, BotTaskKind> | undefined,
): Vector2 {
  let vx = vel.x;
  let vy = vel.y;
  for (const other of robots) {
    if (other.id === selfId) continue;
    const dx = pose.x - other.pose.x;
    const dy = pose.y - other.pose.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SEPARATION_RANGE_IN || dist < 0.1) continue;

    const otherTask = allyTasks?.get(other.id);
    let push =
      dist < MIN_SEP_DIST
        ? ((MIN_SEP_DIST - dist) / MIN_SEP_DIST) * (other.alliance === selfAlliance ? 26 : 22)
        : ((SEPARATION_RANGE_IN - dist) / (SEPARATION_RANGE_IN - MIN_SEP_DIST)) * 10;
    if (selfTask === 'auto_drive' || selfTask === 'auto_hold') {
      push *= 0.55;
    }
    if (other.alliance === selfAlliance) {
      if (otherTask === 'score') push *= 1.8;
      if (otherTask === 'gate') push *= 1.5;
      if (otherTask === 'park' && selfTask === 'park') {
        push *= dist < 44 ? 0.28 : 1.2;
      }
    } else {
      push *= 1.25;
      if (selfTask === 'park' && otherTask === 'park') {
        if (dist < 44) {
          const selfOver = parkPassVerticalSide(selfId, other.id) > 0;
          const ySpread = Math.abs(pose.y - other.pose.y);
          push *= ySpread > 8 ? 0.22 : selfOver ? 0.32 : 0.32;
        } else {
          push *= 1.2;
        }
      }
    }

    const relVelX = vx - other.linear.x;
    const relVelY = vy - other.linear.y;
    const closing = -(dx * relVelX + dy * relVelY) / dist;
    if (closing > 6 && dist < 42) push *= 1.5;

    vx += (dx / dist) * push;
    vy += (dy / dist) * push;

    if (dist < MIN_SEP_DIST) {
      const towardOther = (vx * (-dx) + vy * (-dy)) / dist;
      if (towardOther > 0) {
        vx += (dx / dist) * towardOther * 0.5;
        vy += (dy / dist) * towardOther * 0.5;
      }
    }
  }
  return { x: vx, y: vy };
}

function opponentGateRepulsionParams(
  pose: Vector2,
  alliance: Alliance,
  task: BotTaskKind,
  gateAssignees: ReadonlySet<string>,
  robotId: string,
): { radius: number; strength: number } | null {
  if (task === 'gate' || gateAssignees.has(robotId)) return null;

  const dist = distToOpponentGate(pose, alliance);
  let radius =
    task === 'collect' ? OPPONENT_GATE_COLLECT_REPEL_RADIUS : OPPONENT_GATE_AVOID_RADIUS;
  let strength =
    task === 'collect' ? OPPONENT_GATE_COLLECT_REPEL_STRENGTH : OPPONENT_GATE_AVOID_STRENGTH;
  if (task === 'score') {
    radius = Math.max(radius, 42);
    strength = Math.max(strength, 56);
  } else if (task === 'park') {
    radius = Math.max(radius, 38);
    strength = Math.max(strength, 48);
  }

  if (shouldAvoidOpponentGateZone(pose, alliance, task, gateAssignees, robotId)) {
    radius = Math.max(radius, OPPONENT_GATE_ARTIFACT_PENALTY_IN + 14);
    strength = Math.max(strength, 82);
  }
  if (dist < OPPONENT_GATE_ARTIFACT_PENALTY_IN) {
    strength = Math.max(strength, 96);
  }

  return { radius, strength };
}

function dampVelocityTowardOpponentGate(
  vel: Vector2,
  pose: Vector2,
  alliance: Alliance,
  radius: number,
): Vector2 {
  const gate = opponentGatePoint(alliance);
  const dx = gate.x - pose.x;
  const dy = gate.y - pose.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius || dist < 0.5) return vel;
  const toward = (vel.x * dx + vel.y * dy) / dist;
  if (toward <= 0) return vel;
  const cut = toward * (0.35 + 0.45 * (1 - dist / radius));
  return { x: vel.x - (dx / dist) * cut, y: vel.y - (dy / dist) * cut };
}

function applyOpponentGateAvoidance(
  vel: Vector2,
  pose: Pose,
  alliance: Alliance,
  task: BotTaskKind,
  gateAssignees: ReadonlySet<string>,
  robotId: string,
): Vector2 {
  const params = opponentGateRepulsionParams(pose, alliance, task, gateAssignees, robotId);
  if (!params) return vel;

  const opponentGate = opponentGatePoint(alliance);
  const gateRep = repulsionFromPoint(pose, opponentGate, params.radius, params.strength);
  let vx = vel.x + gateRep.x;
  let vy = vel.y + gateRep.y;

  const wall = opponentGoalWallRepulsion(pose, alliance);
  vx += wall.x;
  vy += wall.y;

  return dampVelocityTowardOpponentGate({ x: vx, y: vy }, pose, alliance, params.radius);
}

function playerAutoRepulsion(
  pose: Pose,
  robots: BotRobotSnapshot[],
  task: BotTaskKind,
): Vector2 {
  if (task !== 'auto_hold' && task !== 'auto_drive') return { x: 0, y: 0 };
  const player = robots.find((robot) => robot.id === 'player');
  if (!player) return { x: 0, y: 0 };
  const strength = task === 'auto_hold' ? 42 : 22;
  const radius = task === 'auto_hold' ? 34 : 26;
  return repulsionFromPoint(pose, player.pose, radius, strength);
}

export function applyBotAvoidance(
  input: HolonomicInput,
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  field: FieldDefinition,
  task: BotTaskKind,
  opponentInTunnel: boolean,
  driveFrame: DriveFrame = 'field',
  allyTasks?: ReadonlyMap<string, BotTaskKind>,
  gateAssignees?: ReadonlySet<string>,
): HolonomicInput {
  let vel = inputToFieldVel(input, pose.heading, driveFrame);

  vel = applyOpponentGateAvoidance(
    vel,
    pose,
    selfAlliance,
    task,
    gateAssignees ?? new Set(),
    selfId,
  );

  if (opponentInOurSecretTunnel(robots, selfAlliance, field) && task !== 'gate') {
    const tunnel = ourSecretTunnelRepulsion(pose, selfAlliance, field);
    vel.x += tunnel.x;
    vel.y += tunnel.y;
    const damp = 0.55;
    vel.x *= damp;
    vel.y *= damp;
  }

  if (opponentInTunnel) {
    const tunnel = secretTunnelRepulsion(pose, robots, selfAlliance, field);
    vel.x += tunnel.x;
    vel.y += tunnel.y;
    const oppZone = secretTunnelZone(field, selfAlliance === 'blue' ? 'red' : 'blue');
    if (oppZone && pointInPolygon(pose, oppZone.polygon)) {
      vel.x *= 0.25;
      vel.y *= 0.25;
    }
  }

  if (task !== 'gate' && task !== 'score') {
    const wall = goalWallRepulsion(pose, selfAlliance);
    vel.x += wall.x;
    vel.y += wall.y;
  }

  const allyRep = allyShootingSpaceRepulsion(
    pose,
    robots,
    selfId,
    selfAlliance,
    task,
    allyTasks,
  );
  vel.x += allyRep.x;
  vel.y += allyRep.y;

  const gateLane = allyGateLaneRepulsion(
    pose,
    robots,
    selfId,
    selfAlliance,
    task,
    allyTasks,
    gateAssignees,
  );
  vel.x += gateLane.x;
  vel.y += gateLane.y;

  const parkRep = allyParkRepulsion(pose, robots, selfId, selfAlliance, task, allyTasks);
  vel.x += parkRep.x;
  vel.y += parkRep.y;

  const oppBase = opponentBaseRepulsion(pose, selfAlliance, field, task);
  vel.x += oppBase.x;
  vel.y += oppBase.y;

  const playerRep = playerAutoRepulsion(pose, robots, task);
  vel.x += playerRep.x;
  vel.y += playerRep.y;

  vel = applyRobotSeparation(vel, pose, robots, selfId, selfAlliance, task, allyTasks);
  return fieldVelToInput(input, vel, pose.heading, driveFrame);
}

/** Light avoidance during Pedro AUTO — yield to player/robots without gate-wall repulsion. */
export function applyBotAutoDriveAvoidance(
  input: HolonomicInput,
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance,
  driveFrame: DriveFrame = 'robot',
  allyTasks?: ReadonlyMap<string, BotTaskKind>,
): HolonomicInput {
  let vel = inputToFieldVel(input, pose.heading, driveFrame);
  const playerRep = playerAutoRepulsion(pose, robots, 'auto_drive');
  vel.x += playerRep.x;
  vel.y += playerRep.y;
  vel = applyRobotSeparation(vel, pose, robots, selfId, selfAlliance, 'auto_drive', allyTasks);
  return fieldVelToInput(input, vel, pose.heading, driveFrame);
}

export function detectOpponentInSecretTunnel(
  robots: BotRobotSnapshot[],
  selfAlliance: Alliance,
  field: FieldDefinition,
): boolean {
  return opponentInSecretTunnel(robots, selfAlliance, field);
}
