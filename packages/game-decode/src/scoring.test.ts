import { describe, expect, it } from 'vitest';
import { countCompletePatternGroups, countPatternMatchesForAlliance } from './pattern.js';
import { validateRules, DECODE_RULES } from './rules-loader.js';
import { DecodeRulesEngine } from './rules-engine.js';
import { getDecodeField } from '@ftc-sim/season-decode';

describe('DECODE rules', () => {
  it('validates scoring table against manual Table 10-2', () => {
    expect(() => validateRules()).not.toThrow();
    expect(DECODE_RULES.scoring.leave).toBe(3);
    expect(DECODE_RULES.scoring.classified).toBe(3);
    expect(DECODE_RULES.scoring.overflow).toBe(1);
    expect(DECODE_RULES.scoring.patternPerArtifact).toBe(2);
  });

  it('skips AUTO LEAVE when the auto period never ran', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('teleop', 90);

    const outsideLaunch = [
      { x: 60, y: 60 },
      { x: 66, y: 60 },
      { x: 66, y: 66 },
      { x: 60, y: 66 },
    ];

    expect(
      engine.evaluateAutoLeave([{ id: 'player', alliance: 'blue', footprint: outsideLaunch }]),
    ).toBe(0);
    expect(engine.getState().byAlliance.blue.autoScore.leave).toBe(0);
    expect(engine.getState().leaveScored).toBe(false);
  });

  it('awards AUTO LEAVE when robot footprint clears all launch zones', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('auto', 29);

    const outsideLaunch = [
      { x: 60, y: 60 },
      { x: 66, y: 60 },
      { x: 66, y: 66 },
      { x: 60, y: 66 },
    ];

    engine.evaluateAutoLeave([{ id: 'player', alliance: 'blue', footprint: outsideLaunch }]);
    const state = engine.getState();
    expect(state.byAlliance.blue.autoScore.leave).toBe(3);
    expect(state.robotLeave.player).toBe(true);
    expect(state.leaveScored).toBe(true);
  });

  it('denies AUTO LEAVE when robot still overlaps a launch zone', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('auto', 29);

    const inNearLaunch = [
      { x: 70, y: 140 },
      { x: 74, y: 140 },
      { x: 74, y: 136 },
      { x: 70, y: 136 },
    ];

    engine.evaluateAutoLeave([{ id: 'player', alliance: 'blue', footprint: inNearLaunch }]);
    const state = engine.getState();
    expect(state.byAlliance.blue.autoScore.leave).toBe(0);
    expect(state.robotLeave.player).toBeUndefined();
  });

  it('awards LEAVE for both alliance robots once each', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('auto', 29);

    const outside = [
      { x: 60, y: 60 },
      { x: 66, y: 60 },
      { x: 66, y: 66 },
      { x: 60, y: 66 },
    ];

    engine.evaluateAutoLeave([
      { id: 'blue-a', alliance: 'blue', footprint: outside },
      { id: 'blue-b', alliance: 'blue', footprint: outside },
    ]);
    expect(engine.getState().byAlliance.blue.autoScore.leave).toBe(6);
    expect(engine.getState().robotLeave['blue-a']).toBe(true);
    expect(engine.getState().robotLeave['blue-b']).toBe(true);
  });

  it('evaluateAutoLeave is idempotent', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'red', motif: '21' });
    engine.syncPhase('auto', 29);
    const outside = [
      { x: 60, y: 60 },
      { x: 66, y: 60 },
      { x: 66, y: 66 },
      { x: 60, y: 66 },
    ];
    const robots = [{ id: 'red-1', alliance: 'red' as const, footprint: outside }];
    expect(engine.evaluateAutoLeave(robots)).toBe(3);
    expect(engine.evaluateAutoLeave(robots)).toBe(0);
    expect(engine.getState().byAlliance.red.autoScore.leave).toBe(3);
  });

  it('tracks classified scoring in auto', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'red', motif: '21' });
    engine.syncPhase('auto', 5);
    engine.classifyArtifact('red', 'purple', true);
    expect(engine.getState().autoScore.classified).toBe(3);
    expect(engine.getState().score.total).toBe(3);
  });

  it('tracks overflow scoring in teleop', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue' });
    engine.syncPhase('teleop', 90);
    engine.classifyArtifact('blue', 'green', false);
    expect(engine.getState().teleopScore.overflow).toBe(1);
    expect(engine.getState().score.total).toBe(1);
  });

  it('scores into the basin alliance even when playing the opponent', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue' });
    engine.syncPhase('teleop', 90);
    engine.classifyArtifact('red', 'purple', true);
    engine.classifyArtifact('red', 'green', false);
    expect(engine.getState().score.total).toBe(0);
    expect(engine.getState().byAlliance.red.score.total).toBe(4);
    expect(engine.getState().byAlliance.blue.score.total).toBe(0);
  });

  it('counts complete pattern groups separately from individual matches', () => {
    const ramp: ('green' | 'purple' | null)[] = [
      'green',
      'purple',
      'purple',
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    expect(countPatternMatchesForAlliance(ramp, '21')).toBe(3);
    expect(countCompletePatternGroups(ramp, '21')).toBe(1);
  });

  it('scores parking for every alliance robot and awards both-full bonus', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('teleop', 120);

    const blueFull = [
      { x: 97, y: 25 },
      { x: 113, y: 25 },
      { x: 113, y: 41 },
      { x: 97, y: 41 },
    ];
    const bluePartial = [
      { x: 97, y: 25 },
      { x: 113, y: 25 },
      { x: 113, y: 45 },
      { x: 97, y: 41 },
    ];
    const redPartial = [
      { x: 25, y: 25 },
      { x: 41, y: 25 },
      { x: 41, y: 45 },
      { x: 25, y: 41 },
    ];

    engine.evaluateMatchParking([
      { id: 'blue-a', alliance: 'blue', footprint: blueFull },
      { id: 'blue-b', alliance: 'blue', footprint: bluePartial },
      { id: 'red-a', alliance: 'red', footprint: redPartial },
      { id: 'red-b', alliance: 'red', footprint: redPartial },
    ]);

    const state = engine.getState();
    expect(state.byAlliance.blue.teleopScore.base).toBe(15);
    expect(state.byAlliance.blue.teleopScore.allianceBonus).toBe(0);
    expect(state.byAlliance.red.teleopScore.base).toBe(10);
    expect(state.robotParking['blue-a']).toBe('full');
    expect(state.robotParking['blue-b']).toBe('partial');
  });

  it('awards minor foul points to victim alliance with cooldown', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('teleop', 10);

    const redInBlueTunnel = [
      { x: 138, y: 30 },
      { x: 142, y: 30 },
      { x: 142, y: 50 },
      { x: 138, y: 50 },
    ];
    const bluePartner = [
      { x: 139, y: 35 },
      { x: 143, y: 35 },
      { x: 143, y: 55 },
      { x: 139, y: 55 },
    ];

    engine.tickContactRules(
      [
        { id: 'red-1', alliance: 'red', footprint: redInBlueTunnel },
        { id: 'blue-1', alliance: 'blue', footprint: bluePartner },
      ],
      100,
    );
    engine.tickContactRules(
      [
        { id: 'red-1', alliance: 'red', footprint: redInBlueTunnel },
        { id: 'blue-1', alliance: 'blue', footprint: bluePartner },
      ],
      100,
    );

    const state = engine.getState();
    expect(state.fouls.red.minorCommitted).toBe(1);
    expect(state.byAlliance.blue.teleopScore.foulPoints).toBe(5);
  });

  it('scores pattern for both alliances when gate is closed', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('auto', 5);

    const state = engine.getState();
    state.rampOccupancy.red = ['green', 'purple', 'purple', null, null, null, null, null, null];
    state.rampOccupancy.blue = ['green', 'green', 'green', null, null, null, null, null, null];

    engine.evaluatePattern('auto');
    const after = engine.getState();
    expect(after.byAlliance.red.autoScore.pattern).toBe(6);
    expect(after.byAlliance.red.autoScore.patternMatches).toBe(3);
    expect(after.byAlliance.blue.autoScore.pattern).toBe(2);
    expect(after.byAlliance.blue.autoScore.patternMatches).toBe(1);
  });

  it('skips pattern scoring when gate is open', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'red', motif: '21' });
    engine.syncPhase('auto', 5);

    const state = engine.getState();
    state.rampOccupancy.red = ['green', 'purple', 'purple', null, null, null, null, null, null];
    engine.setGateOpen('red', true);

    engine.evaluatePattern('auto');
    expect(engine.getState().byAlliance.red.autoScore.pattern).toBe(0);
  });

  it('awards gate fouls to victim alliance per G417/G418', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('teleop', 90);

    engine.recordOpponentGateOpened('blue', 'red');
    engine.recordOpponentRampArtifactReleased('blue', 'red', 'ball-1');
    engine.recordOpponentRampArtifactReleased('blue', 'red', 'ball-2');

    const state = engine.getState();
    expect(state.fouls.blue.majorCommitted).toBe(3);
    expect(state.byAlliance.red.teleopScore.foulPoints).toBe(45);
  });

  it('fouls opponent touching robot parked in own BASE during endgame', () => {
    const engine = new DecodeRulesEngine({ field: getDecodeField(), alliance: 'blue', motif: '21' });
    engine.syncPhase('teleop', 120);

    const redInRedBase = [
      { x: 25, y: 25 },
      { x: 41, y: 25 },
      { x: 41, y: 41 },
      { x: 25, y: 41 },
    ];
    const blueTouchingRed = [
      { x: 39, y: 25 },
      { x: 55, y: 25 },
      { x: 55, y: 41 },
      { x: 39, y: 41 },
    ];

    engine.tickContactRules(
      [
        { id: 'red-1', alliance: 'red', footprint: redInRedBase },
        { id: 'blue-1', alliance: 'blue', footprint: blueTouchingRed },
      ],
      15,
    );

    const state = engine.getState();
    expect(state.fouls.blue.majorCommitted).toBe(1);
    expect(state.byAlliance.red.teleopScore.foulPoints).toBe(15);
  });
});
