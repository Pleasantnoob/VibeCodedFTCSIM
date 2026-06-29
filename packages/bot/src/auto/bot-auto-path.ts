import type { Pose } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import {
  AutoSequenceRunner,
  autoSequenceForAlliance,
  autoSequenceOverlayPoints,
  getPathStartPose,
  pathChainForAlliance,
  pathChainToPoints,
  type AutoSequence,
  type PathChain,
} from '@ftc-sim/pedro';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';
import type { BotAutoPath, BotDebugState, BotRobotId, BotSlotConfig } from '../types.js';
import { BOT_AI_VERSION } from '../types.js';

export function allianceForBotRobotId(robotId: BotRobotId): Alliance {
  return robotId === 'red-far' || robotId === 'red-near' ? 'red' : 'blue';
}

export function botAutoStartPose(autoPath: BotAutoPath, robotId: BotRobotId): Pose {
  const alliance = allianceForBotRobotId(robotId);
  const chain = pathChainForAlliance(autoPath.basePathChain, alliance);
  return getPathStartPose(chain);
}

/** Static AUTO path overlays for setup/init (before the match loop ticks bots). */
export function buildBotPathPreviewStates(slots: BotSlotConfig[]): BotDebugState[] {
  return slots
    .filter((slot) => slot.enabled && slot.runAuto && slot.autoPath)
    .map((slot) => {
      const alliance = allianceForBotRobotId(slot.robotId);
      const path = pathOverlayPoints(slot.autoPath!, alliance);
      const target = path.length > 0 ? path[path.length - 1]! : null;
      return {
        robotId: slot.robotId,
        alliance,
        aiVersion: BOT_AI_VERSION,
        driveFrame: 'robot',
        task: 'auto_hold',
        target: target ? { x: target.x, y: target.y } : null,
        storedCount: 0,
        inLaunchZone: false,
        aligned: true,
        atGoal: false,
        stuckPhase: 'normal',
        pathLength: path.length,
        path,
        reactionMsRemaining: 0,
      };
    });
}

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
  if (sequence) {
    return autoSequenceOverlayPoints(sequence, samplesPerSegment);
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
  const { chain, sequence } = alliancePathForBot(autoPath, alliance);
  runner.setPose(pose);
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
  context?: { storedCount: number; inLaunchZone: boolean },
): HolonomicInput {
  if (context) {
    runner.setContext(context);
  }
  runner.setPose(pose);
  runner.setVelocity(linear);
  return runner.updateHolonomic(dt, limits);
}
