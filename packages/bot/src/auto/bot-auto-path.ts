import type { Pose } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import {
  AutoSequenceRunner,
  autoSequenceForAlliance,
  pathChainForAlliance,
  pathChainToPoints,
  type AutoSequence,
  type PathChain,
} from '@ftc-sim/pedro';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import type { BotAutoPath } from '../types.js';

export function alliancePathForBot(
  autoPath: BotAutoPath,
  alliance: Alliance,
): { chain: PathChain; sequence: AutoSequence | null } {
  const chain = pathChainForAlliance(autoPath.basePathChain, alliance);
  const sequence = autoPath.baseAutoSequence
    ? autoSequenceForAlliance(autoPath.baseAutoSequence, alliance)
    : null;
  return { chain, sequence };
}

export function pathOverlayPoints(
  autoPath: BotAutoPath,
  alliance: Alliance,
  samplesPerSegment = 80,
): Array<{ x: number; y: number }> {
  const { chain, sequence } = alliancePathForBot(autoPath, alliance);
  if (sequence?.displayChain) {
    return pathChainToPoints(sequence.displayChain, samplesPerSegment).map((p) => ({
      x: p.x,
      y: p.y,
    }));
  }
  return pathChainToPoints(chain, samplesPerSegment).map((p) => ({ x: p.x, y: p.y }));
}

export function startBotAutoRunner(
  runner: AutoSequenceRunner,
  autoPath: BotAutoPath,
  alliance: Alliance,
  pose: Pose,
  robotMass?: number,
): void {
  if (robotMass !== undefined) {
    runner.updateConstants({ mass: robotMass });
  }
  runner.setPose(pose);
  const { chain, sequence } = alliancePathForBot(autoPath, alliance);
  if (sequence && sequence.steps.length > 0) {
    runner.start(sequence.steps);
    return;
  }
  runner.followPath(chain);
}

export function tickBotAutoRunner(
  runner: AutoSequenceRunner,
  pose: Pose,
  linear: { x: number; y: number },
  dt: number,
  limits: KinematicLimits,
): HolonomicInput {
  runner.setPose(pose);
  runner.setVelocity(linear);
  return runner.updateHolonomic(dt, limits);
}
