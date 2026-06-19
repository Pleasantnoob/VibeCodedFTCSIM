import { describe, expect, it } from 'vitest';
import { parsePedroJson, pathChainToPoints, exportPedroJson } from './path-io.js';
import { BezierLine } from './geometry.js';
import { PathBuilder } from './paths.js';

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

describe('path-io', () => {
  it('parses PedroJSON segment count and length', () => {
    const chain = parsePedroJson({
      paths: [{ type: 'BezierLine', startPoint: { x: 0, y: 0 }, endPoint: { x: 24, y: 24 } }],
    });
    expect(chain.paths.length).toBe(1);
    expect(chain.paths[0].length()).toBeCloseTo(Math.SQRT2 * 24, 1);
  });

  it('exports PedroJSON round-trip', () => {
    const chain = new PathBuilder()
      .addPath(new BezierLine({ x: 0, y: 0, heading: 0 }, { x: 10, y: 10, heading: 0 }))
      .build();
    const json = exportPedroJson(chain);
    expect(json.paths.length).toBe(1);
    expect(json.coordinateSystem).toBe('pedro');
  });

  it('example-path first point matches default spawn (56, 8) without scaling', () => {
    const chain = parsePedroJson(EXAMPLE_PATH);
    const points = pathChainToPoints(chain, 10);
    expect(points[0].x).toBeCloseTo(56, 5);
    expect(points[0].y).toBeCloseTo(8, 5);
    expect(chain.paths.length).toBe(2);
    expect(chain.totalLength()).toBeGreaterThan(50);
  });
});
