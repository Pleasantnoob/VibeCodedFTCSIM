import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_TIMING, MatchClock } from './match-clock.js';

describe('MatchClock', () => {
  it('starts in setup with zero timers', () => {
    const clock = new MatchClock();
    const snap = clock.snapshot();
    expect(snap.phase).toBe('setup');
    expect(snap.timeElapsed).toBe(0);
    expect(snap.timeRemainingInPhase).toBe(0);
    expect(snap.running).toBe(false);
    expect(snap.allowsDrive).toBe(false);
  });

  it('initMatch moves to init', () => {
    const clock = new MatchClock();
    clock.initMatch();
    expect(clock.snapshot().phase).toBe('init');
    expect(clock.snapshot().controlSource).toBe('none');
  });

  it('auto advances to transition then teleop then post', () => {
    const clock = new MatchClock();
    clock.initMatch();
    clock.startAuto();

    clock.tick(DEFAULT_MATCH_TIMING.autoSec);
    let snap = clock.snapshot();
    expect(snap.phase).toBe('transition');
    expect(snap.timeRemainingInPhase).toBeCloseTo(DEFAULT_MATCH_TIMING.transitionSec, 5);
    expect(snap.controlSource).toBe('autonomous');

    clock.tick(DEFAULT_MATCH_TIMING.transitionSec);
    snap = clock.snapshot();
    expect(snap.phase).toBe('teleop');
    expect(snap.timeRemainingInPhase).toBeCloseTo(DEFAULT_MATCH_TIMING.teleopSec, 5);
    expect(snap.controlSource).toBe('human');

    clock.tick(DEFAULT_MATCH_TIMING.teleopSec);
    snap = clock.snapshot();
    expect(snap.phase).toBe('post');
    expect(snap.timeRemainingInPhase).toBe(0);
    expect(snap.allowsDrive).toBe(false);
  });

  it('startTeleop from init jumps to teleop', () => {
    const clock = new MatchClock();
    clock.initMatch();
    clock.startTeleop();
    const snap = clock.snapshot();
    expect(snap.phase).toBe('teleop');
    expect(snap.timeRemainingInPhase).toBe(DEFAULT_MATCH_TIMING.teleopSec);
    expect(snap.controlSource).toBe('human');
    expect(snap.allowsDrive).toBe(true);
  });

  it('pause stops phase timer decay', () => {
    const clock = new MatchClock();
    clock.startAuto();
    clock.tick(5);
    clock.pause();
    const remaining = clock.snapshot().timeRemainingInPhase;
    clock.tick(10);
    expect(clock.snapshot().timeRemainingInPhase).toBeCloseTo(remaining, 5);
    clock.resume();
    clock.tick(1);
    expect(clock.snapshot().timeRemainingInPhase).toBeLessThan(remaining);
  });

  it('reset after mid-match returns to setup', () => {
    const clock = new MatchClock();
    clock.startAuto();
    clock.tick(10);
    clock.reset();
    const snap = clock.snapshot();
    expect(snap.phase).toBe('setup');
    expect(snap.timeElapsed).toBe(0);
    expect(snap.running).toBe(false);
  });

  it('allowsDrive only during active teleop', () => {
    const clock = new MatchClock();
    expect(clock.snapshot().allowsDrive).toBe(false);

    clock.initMatch();
    expect(clock.snapshot().allowsDrive).toBe(false);

    clock.startAuto();
    expect(clock.snapshot().allowsDrive).toBe(false);

    clock.startTeleop();
    expect(clock.snapshot().allowsDrive).toBe(true);

    clock.pause();
    expect(clock.snapshot().allowsDrive).toBe(false);
  });

  it('start() from init begins auto', () => {
    const clock = new MatchClock();
    clock.initMatch();
    clock.start();
    const snap = clock.snapshot();
    expect(snap.phase).toBe('auto');
    expect(snap.running).toBe(true);
  });

  it('startInfinitePractice runs teleop without timer expiry', () => {
    const clock = new MatchClock();
    clock.startInfinitePractice();
    let snap = clock.snapshot();
    expect(snap.phase).toBe('teleop');
    expect(snap.infiniteMode).toBe(true);
    expect(snap.allowsDrive).toBe(true);
    expect(snap.timeRemainingInPhase).toBe(Number.POSITIVE_INFINITY);

    clock.tick(DEFAULT_MATCH_TIMING.teleopSec * 2);
    snap = clock.snapshot();
    expect(snap.phase).toBe('teleop');
    expect(snap.infiniteMode).toBe(true);
    expect(snap.timeElapsed).toBeCloseTo(DEFAULT_MATCH_TIMING.teleopSec * 2, 5);
  });
});
