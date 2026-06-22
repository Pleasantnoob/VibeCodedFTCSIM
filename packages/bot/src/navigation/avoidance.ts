import {
  gateApproachPoint,
  opponentInOurSecretTunnel,
  OPPONENT_GATE_COLLECT_REPEL_RADIUS,
  OPPONENT_GATE_COLLECT_REPEL_STRENGTH,
  opponentGatePoint,
  shouldAvoidOpponentGateZone,
} from '../coordination.js';
import { pointInPolygon, type FieldDefinition, type Pose, type Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import type { DriveFrame, HolonomicInput } from '@ftc-sim/robot';
import type { BotRobotSnapshot, BotTaskKind } from '../types.js';

const MAX_V = 48;
const ROBOT_RADIUS = 14;
const REPULSE_RADIUS = 22;

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

function opponentInSecretTunnel(
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

function secretTunnelRepulsion(
  pose: Pose,
  alliance: Alliance,
  field: FieldDefinition,
): Vector2 {
  const zone = field.zones.find(
    (z) => z.type === 'secret_tunnel' && z.alliance !== alliance,
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
  return repulsionFromPoint(pose, { x: cx, y: cy }, 30, 24);
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
    if (dist > 44 || dist < 0.1) continue;
    const minDist = ROBOT_RADIUS * 2.1;
    if (dist >= minDist) continue;
    let push = ((minDist - dist) / minDist) * (other.alliance === selfAlliance ? 22 : 14);
    if (other.alliance === selfAlliance) {
      const allyTask = allyTasks?.get(other.id);
      if (allyTask === 'score') push *= 1.8;
      if (allyTask === 'gate') push *= 1.5;
      if (allyTask === 'park' && selfTask === 'park') push *= 2.4;
    }
    vx += (dx / dist) * push;
    vy += (dy / dist) * push;
  }
  return { x: vx, y: vy };
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

  const opponentGate = opponentGatePoint(selfAlliance);
  const gateRepRadius =
    task === 'collect' ? OPPONENT_GATE_COLLECT_REPEL_RADIUS : REPULSE_RADIUS;
  let gateRepStrength =
    task === 'collect' ? OPPONENT_GATE_COLLECT_REPEL_STRENGTH : 28;
  if (shouldAvoidOpponentGateZone(pose, selfAlliance, task, gateAssignees ?? new Set(), selfId)) {
    gateRepStrength = Math.max(gateRepStrength, 62);
  }
  const gateRep = repulsionFromPoint(pose, opponentGate, gateRepRadius, gateRepStrength);
  vel.x += gateRep.x;
  vel.y += gateRep.y;

  if (opponentInOurSecretTunnel(robots, selfAlliance, field) && task !== 'gate') {
    const tunnel = ourSecretTunnelRepulsion(pose, selfAlliance, field);
    vel.x += tunnel.x;
    vel.y += tunnel.y;
    const damp = 0.55;
    vel.x *= damp;
    vel.y *= damp;
  }

  if (opponentInTunnel) {
    const tunnel = secretTunnelRepulsion(pose, selfAlliance, field);
    vel.x += tunnel.x;
    vel.y += tunnel.y;
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

export function detectOpponentInSecretTunnel(
  robots: BotRobotSnapshot[],
  selfAlliance: Alliance,
  field: FieldDefinition,
): boolean {
  const opponent: Alliance = selfAlliance === 'blue' ? 'red' : 'blue';
  return opponentInSecretTunnel(robots, opponent, field);
}
