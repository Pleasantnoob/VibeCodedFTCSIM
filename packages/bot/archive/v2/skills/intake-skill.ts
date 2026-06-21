import { artifactTouchesFrontEdge } from '@ftc-sim/mechanisms';
import type { BotObservation, BotTaskGoal } from '../types.js';

export function intakeForTask(
  obs: BotObservation,
  task: BotTaskGoal,
): { intake?: number } {
  if (task.kind !== 'collect' || !task.artifactId) return {};

  const artifact = obs.artifacts.find((entry) => entry.id === task.artifactId);
  if (!artifact || artifact.phase !== 'onField') {
    return obs.self.stored.length < 3 ? { intake: 0.65 } : {};
  }

  const touching = artifactTouchesFrontEdge(
    { x: artifact.pose.x, y: artifact.pose.y },
    obs.self.pose,
    obs.footprint,
  );
  const dist = Math.hypot(artifact.pose.x - obs.self.pose.x, artifact.pose.y - obs.self.pose.y);
  if (touching || dist < 14) {
    return { intake: 1 };
  }
  return obs.self.stored.length < 3 ? { intake: 0.65 } : {};
}
