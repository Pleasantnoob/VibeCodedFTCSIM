import { describe, expect, it } from 'vitest';
import { AutoSequenceRunner } from './auto-sequence.js';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';

const limits = DEFAULT_KINEMATIC_ROBOT.limits;

describe('AutoSequenceRunner', () => {
  it('holds position and reports shoot during a wait step', () => {
    const runner = new AutoSequenceRunner();
    runner.start([{ kind: 'wait', durationSec: 2, name: 'Shoot wait' }]);
    expect(runner.isBusy()).toBe(true);
    expect(runner.shouldAutoShoot()).toBe(true);

    const input = runner.updateHolonomic(0.5, limits);
    expect(input.forward).toBe(0);
    expect(input.brake).toBe(true);
    expect(runner.isBusy()).toBe(true);

    runner.updateHolonomic(1.6, limits);
    expect(runner.isBusy()).toBe(false);
    expect(runner.shouldAutoShoot()).toBe(false);
  });

  it('advances from path to wait step', () => {
    const runner = new AutoSequenceRunner();
    runner.start([
      { kind: 'wait', durationSec: 0.5 },
    ]);
    expect(runner.shouldAutoShoot()).toBe(true);
    runner.updateHolonomic(0.6, limits);
    expect(runner.isBusy()).toBe(false);
  });
});
