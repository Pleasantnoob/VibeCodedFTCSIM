import { describe, expect, it } from 'vitest';
import { DecodeRulesEngine } from '@ftc-sim/game-decode';
import { getDecodeField } from '@ftc-sim/season-decode';
import {
  allianceTotalScore,
  pickBestMatchState,
  resolveMatchOutcome,
} from './match-results-assets';

describe('resolveMatchOutcome', () => {
  it('declares blue winner when only blue scored', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue' });
    engine.classifyArtifact('blue', 'green', true);
    engine.classifyArtifact('blue', 'purple', false);

    const state = engine.getState();
    const outcome = resolveMatchOutcome(state);

    expect(allianceTotalScore(state, 'blue')).toBeGreaterThan(0);
    expect(outcome.blueScore).toBeGreaterThan(outcome.redScore);
    expect(outcome.winner).toBe('blue');
    expect(outcome.outcome).toBe('blue');
    expect(outcome.blueDetail.artifact).toBeGreaterThan(0);
  });

  it('uses legacy teleop/auto mirrors when byAlliance is missing', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue' });
    engine.classifyArtifact('blue', 'green', true);
    const state = engine.getState();
    const legacy = { ...state, byAlliance: undefined as unknown as typeof state.byAlliance };

    const outcome = resolveMatchOutcome(legacy);
    expect(outcome.blueScore).toBe(state.score.total);
    expect(outcome.winner).toBe('blue');
    expect(outcome.blueDetail.artifact).toBeGreaterThan(0);
  });

  it('reports tie when totals match', () => {
    const outcome = resolveMatchOutcome(null);
    expect(outcome.outcome).toBe('tie');
    expect(outcome.winner).toBe(null);
  });

  it('reports tie when both alliance totals are NaN', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue' });
    const state = engine.getState();
    const nanScore = { ...state.score, total: Number.NaN };
    const nanBucket = {
      autoScore: { ...nanScore },
      teleopScore: { ...nanScore },
      score: { ...nanScore },
    };
    state.score = nanScore;
    state.autoScore = { ...nanScore };
    state.teleopScore = { ...nanScore };
    state.byAlliance = { red: { ...nanBucket }, blue: { ...nanBucket } };

    const outcome = resolveMatchOutcome(state);
    expect(outcome.outcome).toBe('tie');
    expect(outcome.winner).toBe(null);
    expect(outcome.redScore).toBe(0);
    expect(outcome.blueScore).toBe(0);
  });

  it('keeps the highest-scoring snapshot', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue' });
    const empty = engine.getState();
    engine.classifyArtifact('blue', 'green', true);
    const scored = engine.getState();

    expect(pickBestMatchState(empty, scored)).toBe(scored);
    expect(pickBestMatchState(scored, empty)).toBe(scored);
  });
});
