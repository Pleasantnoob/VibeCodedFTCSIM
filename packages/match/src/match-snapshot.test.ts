import { describe, expect, it } from 'vitest';
import { matchSnapshotsEqual } from './match-snapshot.js';
import type { MatchSnapshot } from './types.js';

const base: MatchSnapshot = {
  phase: 'auto',
  timeElapsed: 10,
  timeRemainingInPhase: 20,
  running: true,
  paused: false,
  allowsDrive: false,
  controlSource: 'autonomous',
  infiniteMode: false,
};

describe('matchSnapshotsEqual', () => {
  it('returns true for identical HUD fields', () => {
    expect(matchSnapshotsEqual(base, { ...base })).toBe(true);
  });

  it('returns false when phase changes', () => {
    expect(matchSnapshotsEqual(base, { ...base, phase: 'transition' })).toBe(false);
  });

  it('returns false when running changes', () => {
    expect(matchSnapshotsEqual(base, { ...base, running: false })).toBe(false);
  });

  it('treats tiny timer deltas as equal', () => {
    expect(
      matchSnapshotsEqual(base, { ...base, timeRemainingInPhase: base.timeRemainingInPhase - 0.005 }),
    ).toBe(true);
  });
});
