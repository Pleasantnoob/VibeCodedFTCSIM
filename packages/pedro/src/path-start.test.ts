import { describe, expect, it } from 'vitest';
import { parsePedroJson } from './path-io.js';
import { getPathStartPose } from './paths.js';

const EXAMPLE_PATH = {
  version: '1.0',
  coordinateSystem: 'pedro',
  paths: [
    {
      type: 'BezierLine' as const,
      startPoint: { x: 56, y: 8 },
      endPoint: { x: 56, y: 40 },
      headingInterpolation: {
        mode: 'linear' as const,
        startHeading: Math.PI / 2,
        endHeading: Math.PI / 2,
        endTime: 0.8,
      },
    },
    {
      type: 'BezierCurve' as const,
      startPoint: { x: 56, y: 40 },
      controlPoint1: { x: 56, y: 58 },
      controlPoint2: { x: 64, y: 72 },
      endPoint: { x: 72, y: 72 },
      headingInterpolation: { mode: 'tangent' as const },
    },
  ],
};

describe('getPathStartPose', () => {
  it('returns first segment pose at t=0 for decode-auto example', () => {
    const chain = parsePedroJson(EXAMPLE_PATH);
    const start = getPathStartPose(chain);
    expect(start.x).toBeCloseTo(56, 5);
    expect(start.y).toBeCloseTo(8, 5);
    expect(start.heading).toBeCloseTo(Math.PI / 2, 5);
  });

  it('throws when chain has no paths', () => {
    const chain = parsePedroJson({ paths: [] });
    expect(() => getPathStartPose(chain)).toThrow(/no paths/i);
  });
});
