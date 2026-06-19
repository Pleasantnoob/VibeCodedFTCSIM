import { describe, expect, it } from 'vitest';
import { PIDFController } from './control.js';

describe('PIDFController', () => {
  it('returns proportional correction', () => {
    const pid = new PIDFController(1, 0, 0, 0);
    expect(pid.update(2, 0, 0.02)).toBeCloseTo(2, 5);
  });

  it('reset clears integral state', () => {
    const pid = new PIDFController(0, 1, 0, 0);
    pid.update(1, 0, 1);
    pid.reset();
    expect(pid.update(1, 0, 1)).toBeCloseTo(1, 5);
  });
});
