import type { BotObservation, BotTaskGoal } from '../types.js';

export function parkMechanism(_obs: BotObservation, task: BotTaskGoal): Record<string, never> {
  if (task.kind !== 'park') return {};
  return {};
}
