import type { MatchSnapshot } from './types.js';

export type MatchAudioCue =
  | 'charge'
  | 'endAutoWarning'
  | 'countdown'
  | 'firebell'
  | 'whistle'
  | 'endMatch';

function crossedBelow(prev: number, next: number, threshold: number): boolean {
  return prev > threshold && next <= threshold;
}

/** Returns sound cues that should fire between two consecutive match snapshots. */
export function matchAudioCues(prev: MatchSnapshot | null, next: MatchSnapshot): MatchAudioCue[] {
  if (!prev) return [];

  const cues: MatchAudioCue[] = [];
  const timed = !next.infiniteMode;

  if (prev.phase !== 'auto' && next.phase === 'auto') {
    cues.push('charge');
  }

  if (prev.phase === 'auto' && next.phase === 'transition') {
    cues.push('endAutoWarning');
  }

  if (
    timed &&
    next.phase === 'transition' &&
    crossedBelow(prev.timeRemainingInPhase, next.timeRemainingInPhase, 3)
  ) {
    cues.push('countdown');
  }

  if (timed && prev.phase !== 'teleop' && next.phase === 'teleop') {
    cues.push('firebell');
  }

  if (
    timed &&
    next.phase === 'teleop' &&
    crossedBelow(prev.timeRemainingInPhase, next.timeRemainingInPhase, 20)
  ) {
    cues.push('whistle');
  }

  if (prev.phase === 'teleop' && next.phase === 'post') {
    cues.push('endMatch');
  }

  return cues;
}
