import { describe, expect, it } from 'vitest';
import { AutoSequenceRunner } from './auto-sequence.js';
import { PathChain } from './paths.js';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';

const limits = DEFAULT_KINEMATIC_ROBOT.limits;

describe('AutoSequenceRunner', () => {
  it('holds position during a shoot wait until storage is empty', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 2, inLaunchZone: true });
    runner.start([{ kind: 'wait', durationSec: 5, name: 'Shoot wait' }]);
    expect(runner.isBusy()).toBe(true);
    expect(runner.isInAutoWait()).toBe(true);
    expect(runner.shouldAutoShoot(false)).toBe(false);
    expect(runner.shouldAutoShoot(true)).toBe(true);
    expect(runner.shouldAutoIntake()).toBe(false);

    const input = runner.updateHolonomic(0.5, limits);
    expect(input.forward).toBe(0);
    expect(input.brake).toBe(true);
    expect(runner.isBusy()).toBe(true);

    runner.setContext({ storedCount: 0 });
    runner.updateHolonomic(0.05, limits);
    expect(runner.isBusy()).toBe(false);
    expect(runner.isInAutoWait()).toBe(false);
    expect(runner.shouldAutoShoot(true)).toBe(false);
  });

  it('holds intake wait until three artifacts are stored then advances without idling for launch zone', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 1, inLaunchZone: false });
    runner.start([{ kind: 'wait', durationSec: 5 }]);
    expect(runner.isInAutoWait()).toBe(true);
    expect(runner.shouldAutoIntake()).toBe(true);
    expect(runner.shouldAutoShoot(true)).toBe(false);

    runner.setContext({ storedCount: 3, inLaunchZone: false });
    runner.updateHolonomic(0.05, limits);
    expect(runner.isBusy()).toBe(false);
  });

  it('times out intake wait and proceeds with partial storage', () => {
    const runner = new AutoSequenceRunner();
    runner.setWaitTimeouts({ intakeFullWaitTimeoutSec: 0.2 });
    runner.setContext({ storedCount: 1, inLaunchZone: false });
    runner.start([{ kind: 'wait', durationSec: 0.2 }]);
    runner.updateHolonomic(0.25, limits);
    expect(runner.isBusy()).toBe(false);
  });

  it('shoots during wait when overlapping launch zone with stored balls', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 3, inLaunchZone: true });
    runner.start([{ kind: 'wait', durationSec: 5 }]);
    expect(runner.shouldAutoShoot(true)).toBe(true);
    expect(runner.shouldAutoIntake()).toBe(false);
  });

  it('shoots while driving through launch zone on a path segment', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 2, inLaunchZone: true });
    runner.start([{ kind: 'path', chain: new PathChain([]) }]);
    expect(runner.getRunnerDebug().phase).toBe('path');
    expect(runner.shouldAutoShoot(true)).toBe(true);
    expect(runner.shouldAutoShoot(false)).toBe(false);
    runner.setContext({ storedCount: 0 });
    expect(runner.shouldAutoShoot(true)).toBe(false);
  });

  it('advances named intake wait when full outside launch zone instead of braking for shoot', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 3, inLaunchZone: false });
    runner.start([{ kind: 'wait', durationSec: 5, name: 'Intake wait' }]);
    expect(runner.isInAutoWait()).toBe(false);
    expect(runner.isBusy()).toBe(false);
  });

  it('keeps intake wait active until three stored or timeout', () => {
    const runner = new AutoSequenceRunner();
    runner.setWaitTimeouts({ intakeFullWaitTimeoutSec: 3.0 });
    runner.setContext({ storedCount: 1, inLaunchZone: false });
    runner.start([{ kind: 'wait', durationSec: 5, name: 'Intake wait' }]);
    expect(runner.isInAutoWait()).toBe(true);
    runner.updateHolonomic(1.5, limits);
    expect(runner.isInAutoWait()).toBe(true);
    runner.setContext({ storedCount: 3 });
    runner.updateHolonomic(0.05, limits);
    expect(runner.isBusy()).toBe(false);
  });

  it('does not skip unnamed intake wait when storage is still empty', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 0, inLaunchZone: false });
    runner.start([{ kind: 'wait', durationSec: 5 }]);
    expect(runner.isInAutoWait()).toBe(true);
    expect(runner.shouldAutoIntake()).toBe(true);
    runner.updateHolonomic(0.5, limits);
    expect(runner.isInAutoWait()).toBe(true);
  });

  it('shoots partial storage in launch zone on unnamed wait', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 2, inLaunchZone: true });
    runner.start([{ kind: 'wait', durationSec: 5 }]);
    expect(runner.shouldAutoShoot(true)).toBe(true);
    expect(runner.shouldAutoIntake()).toBe(false);
  });

  it('skips unnamed wait in launch zone when preload was already shot empty', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 0, inLaunchZone: true });
    runner.start([{ kind: 'wait', durationSec: 5 }]);
    expect(runner.isBusy()).toBe(false);
    expect(runner.isInAutoWait()).toBe(false);
  });

  it('completes shoot wait once storage is empty in launch zone', () => {
    const runner = new AutoSequenceRunner();
    runner.setContext({ storedCount: 3, inLaunchZone: true });
    runner.start([{ kind: 'wait', durationSec: 0.5 }]);
    expect(runner.isInAutoWait()).toBe(true);
    runner.setContext({ storedCount: 0 });
    runner.updateHolonomic(0.05, limits);
    expect(runner.isBusy()).toBe(false);
  });
});
