import type { BotObservation } from '../types.js';
import type { AllianceBlackboard, BotRole } from './blackboard.js';

export function assignRoles(
  obs: BotObservation,
  board: AllianceBlackboard,
): Record<string, BotRole> {
  const allies = [obs.self, ...obs.allies];
  const roles: Record<string, BotRole> = {};

  if (allies.length <= 1) {
    roles[obs.self.id] = obs.self.stored.length > 0 ? 'scorer' : 'collector';
    return roles;
  }

  const sorted = [...allies].sort((a, b) => {
    const aScore = a.stored.length * 10 + (a.id.includes('near') ? 1 : 0);
    const bScore = b.stored.length * 10 + (b.id.includes('near') ? 1 : 0);
    return bScore - aScore;
  });

  roles[sorted[0]!.id] = sorted[0]!.stored.length > 0 ? 'scorer' : 'collector';
  roles[sorted[1]!.id] = sorted[1]!.stored.length >= 2 ? 'scorer' : 'collector';

  const rampFull =
    obs.game.rampOccupancy[obs.self.alliance].filter((s: unknown) => s !== null).length >= 6;
  if (rampFull && obs.match.timeRemainingInPhase > 30) {
    const defenderId = sorted.find((ally) => ally.id !== roles[sorted[0]!.id])?.id;
    if (defenderId) roles[defenderId] = 'defender';
  }

  if (obs.match.timeRemainingInPhase <= 25) {
    for (const ally of allies) {
      if (!roles[ally.id] || roles[ally.id] === 'collector') {
        roles[ally.id] = 'park';
      }
    }
  }

  for (const [id, role] of Object.entries(roles)) {
    board.setRole(id, role);
  }

  return roles;
}
