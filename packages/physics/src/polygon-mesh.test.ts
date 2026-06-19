import { describe, expect, it } from 'vitest';
import { ensureCounterClockwise, triangulatePolygon } from './polygon-mesh.js';

describe('polygon mesh', () => {
  it('triangulates a concave pentagon', () => {
    const vertices = ensureCounterClockwise([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 4 },
    ]);
    const indices = triangulatePolygon(vertices);
    expect(indices.length).toBe(9);
  });
});
