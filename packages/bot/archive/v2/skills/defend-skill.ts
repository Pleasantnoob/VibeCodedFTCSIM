import type { BotObservation, BotTaskGoal } from '../types.js';

export function defendMechanism(_obs: BotObservation, task: BotTaskGoal): { intake?: number } {
  if (task.kind !== 'defend') return {};
  return { intake: 0 };
}
