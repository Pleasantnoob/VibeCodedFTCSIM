import type { Vector2 } from '@ftc-sim/field';
import type { BotArtifactSnapshot, BotRobotSnapshot } from '../types.js';

export interface PredictedPosition {
  position: Vector2;
  confidence: number;
}

const DEFAULT_HORIZON_SEC = 0.6;

export function predictPosition(
  pose: Vector2,
  velocity: Vector2,
  horizonSec = DEFAULT_HORIZON_SEC,
): Vector2 {
  return {
    x: pose.x + velocity.x * horizonSec,
    y: pose.y + velocity.y * horizonSec,
  };
}

export function predictArtifact(
  artifact: BotArtifactSnapshot,
  horizonSec = 0.4,
): PredictedPosition {
  return {
    position: { ...artifact.pose },
    confidence: artifact.phase === 'onField' ? 0.7 : 0.2,
  };
}

export function predictRobot(
  robot: BotRobotSnapshot,
  horizonSec = DEFAULT_HORIZON_SEC,
): PredictedPosition {
  const speed = Math.hypot(robot.linear.x, robot.linear.y);
  return {
    position: predictPosition(robot.pose, robot.linear, horizonSec),
    confidence: speed > 4 ? 0.85 : 0.5,
  };
}

export function predictedEtaSeconds(from: Vector2, to: Vector2, maxSpeed = 40): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return dist / Math.max(maxSpeed, 1);
}

export function opponentEtaToArtifact(
  opponent: BotRobotSnapshot,
  artifactPos: Vector2,
): number {
  const predicted = predictRobot(opponent, 0.5);
  return predictedEtaSeconds(predicted.position, artifactPos);
}
