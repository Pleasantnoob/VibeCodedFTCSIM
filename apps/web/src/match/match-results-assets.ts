import type { Alliance, MatchState, ScoreBreakdown } from '@ftc-sim/game-decode';
import { sumScore } from '@ftc-sim/game-decode';

export type MatchOutcome = 'red' | 'blue' | 'tie';

export const MATCH_RESULTS_AUDIO = '/ftc-live/audio/results.wav';
export const MATCH_END_DELAY_MS = 3000;
/** Crossfade from win reveal video into the score results overlay. */
export const MATCH_RESULTS_CROSSFADE_MS = 2000;
/** Win/tie reveal video at 25% of the match volume slider (results sting uses full match volume). */
export const MATCH_REVEAL_VIDEO_VOLUME = 0.25;

export const MATCH_WIN_VIDEOS: Record<MatchOutcome, string> = {
  red: '/ftc-live/video/red-win.webm',
  blue: '/ftc-live/video/blue-win.webm',
  tie: '/ftc-live/video/tie.webm',
};

/** FTC Live PrimaryMatch logos (light variants for dark top/bottom bars). */
export const MATCH_RESULTS_GAME_LOGO =
  '/ftc-live/img/logos/decode_season_primary_invert-baef60f21c2424c9173e9460ed73ba1b.svg';
export const MATCH_RESULTS_PROGRAM_LOGO =
  '/ftc-live/img/logos/ftc_horiz_reverse-e2aa573d7bb7753cfd1cfd8de6b01a81.svg';

export interface AllianceScoreDetail {
  leave: number;
  artifact: number;
  pattern: number;
  base: number;
  foul: number;
  total: number;
}

export interface ResolvedMatchOutcome {
  outcome: MatchOutcome;
  redScore: number;
  blueScore: number;
  winner: 'red' | 'blue' | null;
  redDetail: AllianceScoreDetail;
  blueDetail: AllianceScoreDetail;
}

const EMPTY_SCORE: ScoreBreakdown = {
  leave: 0,
  classified: 0,
  overflow: 0,
  depot: 0,
  pattern: 0,
  patternMatches: 0,
  base: 0,
  allianceBonus: 0,
  foulPoints: 0,
  total: 0,
};

const EMPTY_OUTCOME: ResolvedMatchOutcome = {
  outcome: 'tie',
  redScore: 0,
  blueScore: 0,
  winner: null,
  redDetail: { leave: 0, artifact: 0, pattern: 0, base: 0, foul: 0, total: 0 },
  blueDetail: { leave: 0, artifact: 0, pattern: 0, base: 0, foul: 0, total: 0 },
};

function safeScore(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function mergeScoreBreakdowns(a: ScoreBreakdown, b: ScoreBreakdown): ScoreBreakdown {
  const merged: ScoreBreakdown = {
    leave: safeScore(a.leave) + safeScore(b.leave),
    classified: safeScore(a.classified) + safeScore(b.classified),
    overflow: safeScore(a.overflow) + safeScore(b.overflow),
    depot: safeScore(a.depot) + safeScore(b.depot),
    pattern: safeScore(a.pattern) + safeScore(b.pattern),
    patternMatches: safeScore(a.patternMatches) + safeScore(b.patternMatches),
    base: safeScore(a.base) + safeScore(b.base),
    allianceBonus: safeScore(a.allianceBonus) + safeScore(b.allianceBonus),
    foulPoints: safeScore(a.foulPoints) + safeScore(b.foulPoints),
    total: 0,
  };
  merged.total = sumScore(merged);
  return merged;
}

function scoreDetailFromBreakdown(score: ScoreBreakdown): AllianceScoreDetail {
  const rawTotal = score.total > 0 ? score.total : sumScore(score);
  return {
    leave: safeScore(score.leave),
    artifact: safeScore(score.classified) + safeScore(score.overflow) + safeScore(score.depot),
    pattern: safeScore(score.pattern),
    base: safeScore(score.base),
    foul: safeScore(score.foulPoints),
    total: safeScore(rawTotal),
  };
}

function legacyPlayingAllianceScore(state: MatchState): ScoreBreakdown {
  const fromBuckets = mergeScoreBreakdowns(state.autoScore ?? EMPTY_SCORE, state.teleopScore ?? EMPTY_SCORE);
  if (fromBuckets.total > 0) return fromBuckets;
  if ((state.score?.total ?? 0) > 0) return state.score;
  return fromBuckets;
}

export function mergedAllianceScore(state: MatchState | null, alliance: Alliance): ScoreBreakdown {
  if (!state) return EMPTY_SCORE;

  const bucket = state.byAlliance?.[alliance];
  if (bucket) {
    const merged = mergeScoreBreakdowns(bucket.autoScore ?? EMPTY_SCORE, bucket.teleopScore ?? EMPTY_SCORE);
    if (merged.total > 0) return merged;
    if ((bucket.score?.total ?? 0) > 0) {
      return { ...merged, total: bucket.score.total };
    }
  }

  if (state.alliance === alliance) {
    return legacyPlayingAllianceScore(state);
  }

  return EMPTY_SCORE;
}

export function buildAllianceScoreDetail(state: MatchState | null, alliance: Alliance): AllianceScoreDetail {
  return scoreDetailFromBreakdown(mergedAllianceScore(state, alliance));
}

export function allianceTotalScore(state: MatchState | null, alliance: Alliance): number {
  return buildAllianceScoreDetail(state, alliance).total;
}

export function combinedAlliancePoints(state: MatchState | null): number {
  return allianceTotalScore(state, 'red') + allianceTotalScore(state, 'blue');
}

export function pickBestMatchState(
  previous: MatchState | null,
  next: MatchState | null,
): MatchState | null {
  if (!next) return previous;
  if (!previous) return next;
  return combinedAlliancePoints(next) >= combinedAlliancePoints(previous) ? next : previous;
}

/** Solo sim: robot alliance earns points; opponent stays at 0 unless scored. */
export function resolveMatchOutcome(matchGameState: MatchState | null): ResolvedMatchOutcome {
  if (!matchGameState) return EMPTY_OUTCOME;

  let redDetail = buildAllianceScoreDetail(matchGameState, 'red');
  let blueDetail = buildAllianceScoreDetail(matchGameState, 'blue');

  const playing = matchGameState.alliance;
  const playingLegacy = legacyPlayingAllianceScore(matchGameState);
  if (playingLegacy.total > 0 || sumScore(playingLegacy) > 0) {
    const playingDetail = scoreDetailFromBreakdown(playingLegacy);
    if (playing === 'blue') {
      blueDetail = playingDetail;
    } else {
      redDetail = playingDetail;
    }
  }

  const redScore = safeScore(redDetail.total);
  const blueScore = safeScore(blueDetail.total);
  redDetail = { ...redDetail, total: redScore };
  blueDetail = { ...blueDetail, total: blueScore };

  if (redScore === blueScore) {
    return { outcome: 'tie', redScore, blueScore, winner: null, redDetail, blueDetail };
  }
  if (redScore > blueScore) {
    return { outcome: 'red', redScore, blueScore, winner: 'red', redDetail, blueDetail };
  }
  return { outcome: 'blue', redScore, blueScore, winner: 'blue', redDetail, blueDetail };
}
