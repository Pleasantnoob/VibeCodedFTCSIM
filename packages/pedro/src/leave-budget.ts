import type { AutoSequenceStep } from './auto-sequence.js';
import type { PathChain } from './paths.js';
import { DEFAULT_LEAVE_SAFETY_MARGIN_SEC } from './auto-program.js';

/** Conservative AUTO cruise speed as a fraction of max velocity (in/s). */
const AUTO_CRUISE_FRACTION = 0.72;
const MIN_CRUISE_IN_S = 18;
const WAIT_OVERHEAD_SEC = 0.15;

export function effectiveAutoCruiseSpeedInS(maxVelocity: number): number {
  return Math.max(MIN_CRUISE_IN_S, maxVelocity * AUTO_CRUISE_FRACTION);
}

export function estimatePathChainDurationSec(
  chain: PathChain,
  cruiseSpeedInPerSec: number,
): number {
  const lengthIn = chain.totalLength();
  if (lengthIn < 0.5) return 0.25;
  return lengthIn / cruiseSpeedInPerSec + WAIT_OVERHEAD_SEC;
}

export function estimateSequenceDurationSec(
  steps: AutoSequenceStep[],
  cruiseSpeedInPerSec: number,
): number {
  let total = 0;
  for (const step of steps) {
    if (step.kind === 'wait') {
      total += step.durationSec;
    } else {
      total += estimatePathChainDurationSec(step.chain, cruiseSpeedInPerSec);
    }
  }
  return total;
}

export function estimateLeaveBudgetSec(
  leaveSteps: AutoSequenceStep[],
  safetyMarginSec: number,
  cruiseSpeedInPerSec: number,
): number {
  const travel = estimateSequenceDurationSec(leaveSteps, cruiseSpeedInPerSec);
  return travel + Math.max(0, safetyMarginSec);
}

export function shouldStopLoopForLeave(
  timeRemainingSec: number,
  leaveBudgetSec: number,
): boolean {
  return timeRemainingSec <= leaveBudgetSec;
}

export function defaultLeaveSafetyMarginSec(override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override >= 0) {
    return override;
  }
  return DEFAULT_LEAVE_SAFETY_MARGIN_SEC;
}
