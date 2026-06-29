import type { MatchSnapshot } from './types.js';

/** True when HUD-relevant match clock fields are unchanged. */
export function matchSnapshotsEqual(a: MatchSnapshot, b: MatchSnapshot): boolean {
  return (
    a.phase === b.phase &&
    a.running === b.running &&
    a.paused === b.paused &&
    a.infiniteMode === b.infiniteMode &&
    a.allowsDrive === b.allowsDrive &&
    a.controlSource === b.controlSource &&
    Math.abs(a.timeElapsed - b.timeElapsed) < 0.01 &&
    Math.abs(a.timeRemainingInPhase - b.timeRemainingInPhase) < 0.01
  );
}
