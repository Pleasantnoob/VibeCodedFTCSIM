import type { Pose, Vector2 } from '@ftc-sim/field';
import type { HolonomicInput } from '@ftc-sim/robot';
import type { Alliance } from '@ftc-sim/game-decode';
import type { BotRobotSnapshot } from '../types.js';

const HORIZON_SEC = 0.6;
const ROBOT_RADIUS = 12;
const ALLY_TIME_HORIZON = 0.35;
const OPP_TIME_HORIZON = 0.55;

interface OrcaAgent {
  position: Vector2;
  velocity: Vector2;
  radius: number;
  weight: number;
}

function fieldVelFromInput(input: HolonomicInput): Vector2 {
  return { x: (input.strafe ?? 0) * 50, y: input.forward * 50 };
}

function inputFromFieldVel(input: HolonomicInput, vx: number, vy: number, maxV = 50): HolonomicInput {
  return {
    ...input,
    forward: Math.max(-1, Math.min(1, vy / maxV)),
    strafe: Math.max(-1, Math.min(1, vx / maxV)),
  };
}

function orcaAdjust(
  preferred: Vector2,
  self: OrcaAgent,
  others: OrcaAgent[],
  dt: number,
): Vector2 {
  let vx = preferred.x;
  let vy = preferred.y;

  for (const other of others) {
    const relX = self.position.x - other.position.x;
    const relY = self.position.y - other.position.y;
    const relVx = self.velocity.x - other.velocity.x;
    const relVy = self.velocity.y - other.velocity.y;
    const combined = self.radius + other.radius;
    const distSq = relX * relX + relY * relY;
    const dist = Math.sqrt(distSq) || 1e-6;

    const w = combined / dist;
    const combinedVelX = relVx + relX * w * other.weight;
    const combinedVelY = relVy + relY * w * other.weight;
    const combinedSpeed = Math.hypot(combinedVelX, combinedVelY);
    if (combinedSpeed < 1e-4) continue;

    const invTau = 1 / (HORIZON_SEC * dt * 120);
    const uX = (combinedVelX / combinedSpeed) * Math.min(combinedSpeed, combined * invTau);
    const uY = (combinedVelY / combinedSpeed) * Math.min(combinedSpeed, combined * invTau);

    vx += uX * other.weight;
    vy += uY * other.weight;
  }

  return { x: vx, y: vy };
}

export interface LocalAvoidanceContext {
  selfTaskKind?: string;
  allyTasks?: ReadonlyMap<string, string>;
}

export function applyLocalAvoidance(
  input: HolonomicInput,
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  barriers: Vector2[][],
  selfAlliance?: BotRobotSnapshot['alliance'],
  context: LocalAvoidanceContext = {},
): HolonomicInput {
  void barriers;

  const preferred = fieldVelFromInput(input);
  const self: OrcaAgent = {
    position: { x: pose.x, y: pose.y },
    velocity: preferred,
    radius: ROBOT_RADIUS,
    weight: 1,
  };

  const others: OrcaAgent[] = [];
  for (const robot of robots) {
    if (robot.id === selfId) continue;
    const dist = Math.hypot(pose.x - robot.pose.x, pose.y - robot.pose.y);
    if (dist > 48) continue;

    const sameAlliance = selfAlliance !== undefined && robot.alliance === selfAlliance;
    let weight = sameAlliance ? 0.7 : 0.45;
    if (sameAlliance && context.selfTaskKind && context.allyTasks) {
      const allyTask = context.allyTasks.get(robot.id);
      if (allyTask && allyTask !== context.selfTaskKind) {
        weight *= 0.4;
      }
    }

    const horizon = sameAlliance ? ALLY_TIME_HORIZON : OPP_TIME_HORIZON;
    others.push({
      position: { x: robot.pose.x, y: robot.pose.y },
      velocity: {
        x: robot.linear.x + robot.linear.x * horizon * 0.2,
        y: robot.linear.y + robot.linear.y * horizon * 0.2,
      },
      radius: ROBOT_RADIUS,
      weight,
    });
  }

  if (others.length === 0) return input;

  const adjusted = orcaAdjust(preferred, self, others, 1 / 120);
  return inputFromFieldVel(input, adjusted.x, adjusted.y);
}

export function applyOrcaLite(
  input: HolonomicInput,
  pose: Pose,
  robots: BotRobotSnapshot[],
  selfId: string,
  selfAlliance: Alliance | undefined,
  context: LocalAvoidanceContext = {},
): HolonomicInput {
  return applyLocalAvoidance(input, pose, robots, selfId, [], selfAlliance, context);
}
