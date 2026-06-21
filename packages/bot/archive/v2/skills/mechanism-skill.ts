import type { BotObservation, BotTaskGoal } from '../types.js';
import { intakeForTask } from './intake-skill.js';
import { shootForTask } from './shoot-skill.js';
import { gateForTask } from './gate-skill.js';
import { parkMechanism } from './park-skill.js';
import { defendMechanism } from './defend-skill.js';

export { headingTowardBasin, isAlignedForShot, shotTier } from './shoot-skill.js';

export function mechanismForTask(
  obs: BotObservation,
  task: BotTaskGoal,
  atGoal: boolean,
  aimErrorRad = 0,
): {
  intake?: number;
  shoot?: boolean;
  shootEdge?: boolean;
  shootHeld?: boolean;
  gate?: boolean;
  gateEdge?: boolean;
  reposition?: boolean;
} {
  if (task.kind === 'auto_hold') {
    return {
      ...intakeForTask(obs, task),
      ...shootForTask(obs, task, aimErrorRad),
      intake: 1,
    };
  }

  return {
    ...intakeForTask(obs, task),
    ...shootForTask(obs, task, aimErrorRad),
    ...gateForTask(obs, task, atGoal),
    ...parkMechanism(obs, task),
    ...defendMechanism(obs, task),
  };
}
