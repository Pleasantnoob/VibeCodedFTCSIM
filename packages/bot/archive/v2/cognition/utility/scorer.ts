import type { Vector2 } from '@ftc-sim/field';
import type { BotObservation, BotTaskGoal } from '../../types.js';
import type { AllianceBlackboard } from '../blackboard.js';
import type { ThreatAssessment } from '../../perception/threat-model.js';
import type { BotRole } from '../blackboard.js';
import {
  collectTargetForArtifact,
  goalBasinForAlliance,
  launchApproachForRobot,
  launchNodeHintForRobot,
  nearestArtifactCandidate,
  patrolPoint,
  shootHeading,
  shouldPark,
} from '../task-selector.js';
import { predictedEtaSeconds } from '../../perception/target-predictor.js';

export interface UtilityContext {
  obs: BotObservation;
  board: AllianceBlackboard;
  robotId: string;
  aimErrorRad: number;
  difficulty: 'easy' | 'normal' | 'hard';
  threats: ThreatAssessment;
  role: BotRole;
}

function gateApproach(alliance: 'blue' | 'red'): Vector2 {
  return alliance === 'blue' ? { x: 9, y: 68 } : { x: 135, y: 68 };
}

function baseApproach(alliance: 'blue' | 'red'): Vector2 {
  return alliance === 'blue' ? { x: 105, y: 33 } : { x: 33, y: 33 };
}

function countRampFilled(obs: BotObservation, alliance: 'blue' | 'red'): number {
  return obs.game.rampOccupancy[alliance].filter((slot) => slot !== null).length;
}

function scoreCollect(ctx: UtilityContext): BotTaskGoal | null {
  const { obs, board, robotId } = ctx;
  const artifact = nearestArtifactCandidate(obs, board, obs.self.pose, robotId);
  if (!artifact) return null;

  const { target, goalNodeHint } = collectTargetForArtifact(
    artifact.position,
    obs.self.alliance,
    artifact.row,
  );
  const pathCost = Math.hypot(target.x - obs.self.pose.x, target.y - obs.self.pose.y);
  let utility = 5 - pathCost / 40;

  for (const opp of obs.opponents) {
    const eta = predictedEtaSeconds(opp.pose, artifact.position);
    utility -= Math.max(0, 1.2 - eta / 3);
  }

  if (ctx.board.motifNeed && artifact.color === ctx.board.motifNeed) {
    utility += 0.8;
  }
  if (ctx.role === 'collector') utility += 0.5;

  return {
    kind: 'collect',
    target,
    artifactId: artifact.id,
    goalNodeHint,
    targetHeading: Math.atan2(
      artifact.position.y - target.y,
      artifact.position.x - target.x,
    ),
    utility: utility,
  };
}

function scoreScore(ctx: UtilityContext): BotTaskGoal | null {
  const { obs, robotId, aimErrorRad } = ctx;
  if (obs.self.stored.length === 0) return null;

  const target = launchApproachForRobot(robotId, obs.self.alliance);
  const dist = Math.hypot(target.x - obs.self.pose.x, target.y - obs.self.pose.y);
  let utility = 8 + obs.self.stored.length - dist / 50;
  if (ctx.role === 'scorer') utility += 0.6;

  return {
    kind: 'score',
    target,
    targetHeading: shootHeading(obs, aimErrorRad),
    goalNodeHint: launchNodeHintForRobot(robotId, obs.self.alliance),
    utility: utility,
  };
}

function scoreGate(ctx: UtilityContext): BotTaskGoal | null {
  const { obs } = ctx;
  const rampCount = countRampFilled(obs, obs.self.alliance);
  if (rampCount < 6 || obs.game.gateOpen[obs.self.alliance]) return null;
  if (ctx.board.rampIntent && ctx.role !== 'scorer') return null;

  let utility = 5 + rampCount / 3;
  if (ctx.threats.opponentNearOurGate) utility -= 1.5;
  utility -= ctx.threats.gateFoulRisk;

  return {
    kind: 'gate',
    target: gateApproach(obs.self.alliance),
    goalNodeHint: obs.self.alliance === 'blue' ? 'blue_gate' : 'red_gate',
    utility: utility,
  };
}

function scorePark(ctx: UtilityContext): BotTaskGoal | null {
  const { obs } = ctx;
  if (!shouldPark(obs)) return null;
  if (ctx.board.isParkReservedBy(ctx.robotId)) return null;

  const target = baseApproach(obs.self.alliance);
  const dist = Math.hypot(target.x - obs.self.pose.x, target.y - obs.self.pose.y);
  const utility = 10 - dist / 60 + (25 - obs.match.timeRemainingInPhase) / 25;

  return {
    kind: 'park',
    target,
    targetHeading: Math.PI / 2,
    goalNodeHint: obs.self.alliance === 'blue' ? 'blue_base' : 'red_base',
    utility: utility,
  };
}

function scoreDefend(ctx: UtilityContext): BotTaskGoal | null {
  if (ctx.difficulty === 'easy') return null;
  if (ctx.role !== 'defender' && ctx.difficulty !== 'hard') return null;

  const { obs, threats } = ctx;
  if (!threats.opponentScoring && !threats.opponentNearOurGate) return null;

  const gate = gateApproach(obs.self.alliance);
  const opponent = obs.self.alliance === 'blue' ? 'red' : 'blue';
  const utility =
    4 +
    (threats.opponentNearOurGate ? 1.5 : 0) +
    (obs.game.scores[obs.self.alliance] > obs.game.scores[opponent] ? 0.5 : 0);

  return {
    kind: 'defend',
    target: gate,
    goalNodeHint: obs.self.alliance === 'blue' ? 'blue_gate' : 'red_gate',
    utility: utility,
  };
}

function scoreAuto(ctx: UtilityContext): BotTaskGoal {
  const { obs, robotId, aimErrorRad } = ctx;
  return {
    kind: 'auto_hold',
    target: launchApproachForRobot(robotId, obs.self.alliance),
    targetHeading: shootHeading(obs, aimErrorRad),
    goalNodeHint: launchNodeHintForRobot(robotId, obs.self.alliance),
    utility: 1,
  };
}

function scoreIdle(ctx: UtilityContext): BotTaskGoal {
  const { obs, robotId } = ctx;
  return {
    kind: 'idle',
    target: patrolPoint(robotId, obs.self.alliance),
    utility: 0.2,
  };
}

export function scoreAllCandidates(ctx: UtilityContext): BotTaskGoal[] {
  const { obs } = ctx;

  if (obs.match.phase === 'auto' || obs.match.phase === 'transition') {
    return [scoreAuto(ctx)];
  }

  if (!obs.match.allowsDrive || !obs.match.running || obs.match.paused) {
    return [scoreIdle(ctx)];
  }

  const candidates: BotTaskGoal[] = [];
  const park = scorePark(ctx);
  if (park) candidates.push(park);

  const score = scoreScore(ctx);
  if (score) candidates.push(score);

  const gate = scoreGate(ctx);
  if (gate) candidates.push(gate);

  const defend = scoreDefend(ctx);
  if (defend) candidates.push(defend);

  const collect = scoreCollect(ctx);
  if (collect) candidates.push(collect);

  if (candidates.length === 0) candidates.push(scoreIdle(ctx));

  candidates.sort((a, b) => b.utility - a.utility);
  return candidates;
}
