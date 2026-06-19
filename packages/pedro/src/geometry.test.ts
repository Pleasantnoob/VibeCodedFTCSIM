import { describe, expect, it } from 'vitest';
import { BezierCurve, BezierLine } from './geometry.js';

describe('geometry', () => {
  it('BezierLine endpoints match t=0 and t=1', () => {
    const line = new BezierLine({ x: 0, y: 0, heading: 0 }, { x: 10, y: 10, heading: 0 });
    expect(line.getPose(0)).toMatchObject({ x: 0, y: 0 });
    expect(line.getPose(1)).toMatchObject({ x: 10, y: 10 });
    expect(line.length()).toBeCloseTo(Math.SQRT2 * 10, 5);
  });

  it('BezierCurve passes through start and end', () => {
    const curve = new BezierCurve(
      { x: 0, y: 0, heading: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0, heading: 0 },
    );
    expect(curve.getPose(0)).toMatchObject({ x: 0, y: 0 });
    expect(curve.getPose(1)).toMatchObject({ x: 10, y: 0 });
  });
});
