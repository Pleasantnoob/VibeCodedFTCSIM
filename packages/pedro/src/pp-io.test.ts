import { describe, expect, it } from 'vitest';
import { parseVisualizerAutoSequence, parseVisualizerPp, VISUALIZER_TO_PEDRO } from './pp-io.js';
import { pathChainToPoints } from './path-io.js';
import { getPathStartPose } from './paths.js';

const DECODE_EXPORT_PP = {
  version: '1.2.1',
  startPoint: {
    x: 56,
    y: 8,
    heading: 'linear' as const,
    startDeg: 90,
    endDeg: 180,
  },
  lines: [
    {
      endPoint: {
        x: 56,
        y: 36,
        heading: 'linear' as const,
        startDeg: 90,
        endDeg: 180,
      },
      controlPoints: [],
    },
    {
      endPoint: { x: 12, y: 36, heading: 'tangential' as const },
      controlPoints: [],
    },
  ],
};

describe('pp-io', () => {
  it('scales visualizer coords to Pedro inches', () => {
    expect(VISUALIZER_TO_PEDRO).toBeCloseTo(144 / 141.5, 5);
  });

  it('parses a line from startPoint through lines[]', () => {
    const chain = parseVisualizerPp({
      startPoint: { x: 0, y: 0, heading: 'constant', degrees: 90 },
      lines: [
        {
          endPoint: { x: 141.5, y: 0, heading: 'constant', degrees: 90 },
          controlPoints: [],
        },
      ],
    });
    expect(chain.paths.length).toBe(1);
    const start = chain.paths[0].curve.getStart();
    const end = chain.paths[0].curve.getEnd();
    expect(start.x).toBeCloseTo(0, 5);
    expect(end.x).toBeCloseTo(144, 1);
  });

  it('parses curve with two control points', () => {
    const chain = parseVisualizerPp({
      version: '1.2.0',
      startPoint: { x: 56, y: 8, heading: 'linear', startDeg: 90, endDeg: 90 },
      lines: [
        {
          endPoint: { x: 56, y: 36, heading: 'linear', startDeg: 90, endDeg: 90 },
          controlPoints: [],
        },
        {
          endPoint: { x: 72, y: 48, heading: 'tangential', reverse: false },
          controlPoints: [
            { x: 48, y: 40 },
            { x: 60, y: 48 },
          ],
        },
      ],
    });
    expect(chain.paths.length).toBe(2);
    const points = pathChainToPoints(chain, 5);
    expect(points[0].x).toBeCloseTo(56, 3);
    expect(points[0].y).toBeCloseTo(8, 3);
  });

  it('decode PP export keeps pedro inches and 90° spawn heading', () => {
    const chain = parseVisualizerPp(DECODE_EXPORT_PP);
    const start = getPathStartPose(chain);
    expect(start.x).toBeCloseTo(56, 3);
    expect(start.y).toBeCloseTo(8, 3);
    expect(start.heading).toBeCloseTo(Math.PI / 2, 3);
    expect(chain.paths.length).toBe(2);
    expect(chain.paths[1].getPose(0).heading).toBeCloseTo(Math.PI, 3);
  });

  it('tangential line segment uses path tangent heading', () => {
    const chain = parseVisualizerPp(DECODE_EXPORT_PP);
    const westLine = chain.paths[1];
    expect(westLine.getPose(0.5).heading).toBeCloseTo(Math.PI, 3);
  });

  it('parses sequence wait steps for auto execution', () => {
    const auto = parseVisualizerAutoSequence({
      version: '1.2.1',
      startPoint: { x: 0, y: 0, heading: 'constant', degrees: 90 },
      lines: [
        {
          id: 'a',
          endPoint: { x: 0, y: 10, heading: 'constant', degrees: 90 },
          controlPoints: [],
        },
        {
          id: 'b',
          endPoint: { x: 10, y: 10, heading: 'constant', degrees: 90 },
          controlPoints: [],
          waitAfterMs: 500,
        },
      ],
      sequence: [
        { kind: 'path', lineId: 'a' },
        { kind: 'wait', name: 'Shoot', durationMs: 2000 },
        { kind: 'path', lineId: 'b' },
      ],
    });

    expect(auto.steps.length).toBe(4);
    expect(auto.steps[0]?.kind).toBe('path');
    expect(auto.steps[1]).toEqual({ kind: 'wait', durationSec: 2, name: 'Shoot' });
    expect(auto.steps[2]?.kind).toBe('path');
    expect(auto.steps[3]).toEqual({ kind: 'wait', durationSec: 0.5, name: undefined });
  });
});
