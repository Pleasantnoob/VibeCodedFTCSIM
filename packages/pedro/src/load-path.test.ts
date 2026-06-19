import { describe, expect, it } from 'vitest';
import { parsePathFile, parsePathFileText } from './load-path.js';

describe('load-path', () => {
  it('auto-detects PedroJSON', () => {
    const result = parsePathFile({
      paths: [{ type: 'BezierLine', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } }],
    });
    expect(result.format).toBe('pedro-json');
    expect(result.chain.paths.length).toBe(1);
  });

  it('auto-detects Visualizer .pp', () => {
    const result = parsePathFile({
      startPoint: { x: 0, y: 0, heading: 'constant', degrees: 0 },
      lines: [{ endPoint: { x: 10, y: 0, heading: 'constant', degrees: 0 }, controlPoints: [] }],
    });
    expect(result.format).toBe('visualizer-pp');
    expect(result.chain.paths.length).toBe(1);
  });

  it('throws on unknown format', () => {
    expect(() => parsePathFile({ foo: 'bar' })).toThrow(/Unknown path file format/);
  });

  it('parsePathFileText handles invalid JSON', () => {
    expect(() => parsePathFileText('not json')).toThrow(/Invalid JSON/);
  });

  it('includes autoSequence for visualizer pp with wait steps', () => {
    const result = parsePathFileText(
      JSON.stringify({
        version: '1.2.1',
        startPoint: { x: 0, y: 0, heading: 'constant', degrees: 90 },
        lines: [
          {
            id: 'p1',
            endPoint: { x: 0, y: 10, heading: 'constant', degrees: 90 },
            controlPoints: [],
          },
        ],
        sequence: [
          { kind: 'path', lineId: 'p1' },
          { kind: 'wait', name: 'Wait', durationMs: 1500 },
        ],
      }),
    );
    expect(result.autoSequence?.steps.length).toBe(2);
    expect(result.autoSequence?.steps[1]).toEqual({
      kind: 'wait',
      durationSec: 1.5,
      name: 'Wait',
    });
  });
});
