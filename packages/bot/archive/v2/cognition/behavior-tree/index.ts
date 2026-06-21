import type { BotObservation, BotTaskGoal, BotTaskKind } from '../../types.js';
import type { AllianceBlackboard } from '../blackboard.js';
import { assessThreats } from '../../perception/threat-model.js';
import { scoreAllCandidates, type UtilityContext } from '../utility/scorer.js';
import { assignRoles } from '../role-assignment.js';
import { shouldPark } from '../task-selector.js';
import { applyUtilityNoise } from '../../personality/imperfection.js';

function taskKey(task: BotTaskGoal): string {
  return `${task.kind}|${task.artifactId ?? ''}|${task.goalNodeHint ?? ''}`;
}

const UTILITY_OVERRIDE_DELTA = 0.25;

export interface TacticalDecision {
  task: BotTaskGoal;
  role: ReturnType<typeof assignRoles>[string];
}

export function decideTask(
  obs: BotObservation,
  board: AllianceBlackboard,
  robotId: string,
  aimErrorRad: number,
  difficulty: 'easy' | 'normal' | 'hard',
  currentTask: BotTaskGoal,
  elapsedSec: number,
  taskKindSince: number,
): TacticalDecision {
  const threats = assessThreats(obs);
  const roles = assignRoles(obs, board);
  const role = roles[robotId] ?? 'collector';

  const ctx: UtilityContext = {
    obs,
    board,
    robotId,
    aimErrorRad,
    difficulty,
    threats,
    role,
  };

  const candidates = scoreAllCandidates(ctx);
  let best = candidates[0] ?? currentTask;
  if (best !== currentTask && taskKey(best) !== taskKey(currentTask)) {
    best = { ...best, utility: applyUtilityNoise(best.utility, ctx.difficulty) };
  }

  if (
    best.kind !== currentTask.kind &&
    best.utility - currentTask.utility < UTILITY_OVERRIDE_DELTA
  ) {
    best = currentTask;
  }

  if (
    best.kind !== currentTask.kind &&
    elapsedSec - taskKindSince < 0.4 &&
    best.utility <= currentTask.utility + UTILITY_OVERRIDE_DELTA
  ) {
    best = currentTask;
  }

  if (best.kind === 'collect' && best.artifactId !== currentTask.artifactId) {
    if (
      currentTask.kind === 'collect' &&
      currentTask.artifactId &&
      best.utility - currentTask.utility < UTILITY_OVERRIDE_DELTA
    ) {
      best = currentTask;
    }
  }

  if (currentTask.kind === 'park' && shouldPark(obs)) {
    best = currentTask;
  }

  if (currentTask.kind === 'score' && obs.self.stored.length > 0) {
    const parkCandidate = candidates.find((c: BotTaskGoal) => c.kind === 'park');
    if (parkCandidate && shouldPark(obs)) {
      best = parkCandidate;
    } else {
      best = { ...currentTask, utility: 9 + obs.self.stored.length };
    }
  }

  board.setRole(robotId, role);
  if (best.kind === 'gate') board.setRampIntent(true);
  if (best.kind === 'park') board.reservePark(robotId);

  return { task: best, role };
}

export function taskKindPriority(kind: BotTaskKind): number {
  const order: Record<BotTaskKind, number> = {
    score: 4,
    collect: 3,
    defend: 2,
    gate: 2,
    park: 1,
    auto_hold: 3,
    idle: 0,
  };
  return order[kind] ?? 0;
}
