import { describe, expect, it } from 'vitest';
import { parsePedroJson } from './path-io.js';
import { getPathStartPose } from './paths.js';
import { mirrorPathChain, pathChainForAlliance } from './mirror-path.js';

const BLUE_PATH = {
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

describe('mirrorPathChain', () => {
  it('mirrors x across field center and flips heading for red alliance', () => {
    const blue = parsePedroJson(BLUE_PATH);
    const red = mirrorPathChain(blue);
    const start = getPathStartPose(red);

    expect(start.x).toBeCloseTo(88, 5);
    expect(start.y).toBeCloseTo(8, 5);
    expect(start.heading).toBeCloseTo(Math.PI / 2, 5);
  });

  it('double mirror returns equivalent geometry', () => {
    const blue = parsePedroJson(BLUE_PATH);
    const roundTrip = mirrorPathChain(mirrorPathChain(blue));
    const start = getPathStartPose(roundTrip);

    expect(start.x).toBeCloseTo(56, 5);
    expect(start.y).toBeCloseTo(8, 5);
    expect(start.heading).toBeCloseTo(Math.PI / 2, 5);
  });

  it('pathChainForAlliance keeps blue path unchanged', () => {
    const blue = parsePedroJson(BLUE_PATH);
    const start = getPathStartPose(pathChainForAlliance(blue, 'blue'));
    expect(start.x).toBeCloseTo(56, 5);
  });

  it('pathChainForAlliance mirrors for red', () => {
    const blue = parsePedroJson(BLUE_PATH);
    const start = getPathStartPose(pathChainForAlliance(blue, 'red'));
    expect(start.x).toBeCloseTo(88, 5);
  });
});
