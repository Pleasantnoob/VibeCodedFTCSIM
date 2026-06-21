import type { BotObservation, BotTaskGoal } from '../types.js';

const GATE_GEOFENCE_IN = 8;

export function gateForTask(
  obs: BotObservation,
  task: BotTaskGoal,
  atGoal: boolean,
): { gate?: boolean; gateEdge?: boolean } {
  if (task.kind !== 'gate') return {};
  const gateX = obs.self.alliance === 'blue' ? 9 : 135;
  const dist = Math.hypot(obs.self.pose.x - gateX, obs.self.pose.y - 68);
  if (dist > GATE_GEOFENCE_IN || !atGoal) return {};
  return { gate: true, gateEdge: true };
}
