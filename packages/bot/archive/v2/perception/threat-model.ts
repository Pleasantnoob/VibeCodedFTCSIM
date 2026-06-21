import type { Alliance } from '@ftc-sim/game-decode';
import type { BotObservation } from '../types.js';

export interface ThreatAssessment {
  opponentNearOurGate: boolean;
  opponentCollecting: boolean;
  opponentScoring: boolean;
  contestedCenter: boolean;
  gateFoulRisk: number;
  opponentGateProximity: number;
}

export function assessThreats(obs: BotObservation): ThreatAssessment {
  const alliance = obs.self.alliance;
  const gateNode = alliance === 'blue' ? { x: 9, y: 68 } : { x: 135, y: 68 };
  const ourGateOpen = obs.game.gateOpen[alliance];

  let opponentNearOurGate = false;
  let opponentCollecting = false;
  let opponentScoring = false;
  let gateFoulRisk = 0;
  let opponentGateProximity = Infinity;

  for (const opp of obs.opponents) {
    const gateDist = Math.hypot(opp.pose.x - gateNode.x, opp.pose.y - gateNode.y);
    opponentGateProximity = Math.min(opponentGateProximity, gateDist);
    if (gateDist < 22 && !ourGateOpen) {
      opponentNearOurGate = true;
      gateFoulRisk = Math.max(gateFoulRisk, 1 - gateDist / 22);
    }

    const speed = Math.hypot(opp.linear.x, opp.linear.y);
    const nearArtifacts = obs.artifacts.some(
      (artifact) =>
        artifact.phase === 'onField' &&
        Math.hypot(artifact.pose.x - opp.pose.x, artifact.pose.y - opp.pose.y) < 24,
    );
    if (nearArtifacts && speed > 6) opponentCollecting = true;

    const launchSide = alliance === 'blue' ? opp.pose.x > 60 : opp.pose.x < 84;
    if (launchSide && opp.pose.y > 90 && opp.stored.length > 0) {
      opponentScoring = true;
    }
  }

  const contestedCenter =
    obs.opponents.some((opp) => Math.abs(opp.pose.x - 72) < 24 && Math.abs(opp.pose.y - 72) < 30) &&
    Math.abs(obs.self.pose.x - 72) < 30;

  return {
    opponentNearOurGate,
    opponentCollecting,
    opponentScoring,
    contestedCenter,
    gateFoulRisk,
    opponentGateProximity: Number.isFinite(opponentGateProximity) ? opponentGateProximity : 999,
  };
}

export function opponentGatePenaltyEdge(alliance: Alliance): number {
  return alliance === 'blue' ? 5 : 5;
}
