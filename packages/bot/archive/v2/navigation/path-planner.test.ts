import { describe, expect, it } from 'vitest';
import { buildDecodeFieldGraph, isOpponentNodeId } from './field-graph.js';
import { planPath, pathToPoints } from './path-planner.js';

describe('path planner', () => {
  const { nodes, edges } = buildDecodeFieldGraph();

  it('finds a path from blue spawn to spike row', () => {
    const path = planPath(nodes, edges, 'blue_far_spawn', 'blue_spike_y36', 'blue');
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toBe('blue_far_spawn');
    expect(path[path.length - 1]).toBe('blue_spike_y36');
    const points = pathToPoints(nodes, path);
    expect(points.length).toBeGreaterThan(1);
  });

  it('blue spawn to spike avoids center node', () => {
    const cases: Array<[string, string]> = [
      ['blue_far_spawn', 'blue_spike_y36'],
      ['blue_near_spawn', 'blue_spike_approach_y84'],
      ['blue_near_spawn', 'blue_shoot_near'],
      ['blue_far_spawn', 'blue_shoot_far'],
    ];
    for (const [start, goal] of cases) {
      const path = planPath(nodes, edges, start, goal, 'blue');
      expect(path).not.toContain('center');
    }
  });

  it('red spawn to spike avoids center node', () => {
    const cases: Array<[string, string]> = [
      ['red_far_spawn', 'red_spike_y36'],
      ['red_near_spawn', 'red_spike_approach_y84'],
      ['red_near_spawn', 'red_shoot_near'],
      ['red_far_spawn', 'red_shoot_far'],
    ];
    for (const [start, goal] of cases) {
      const path = planPath(nodes, edges, start, goal, 'red');
      expect(path).not.toContain('center');
    }
  });

  it('blue base path stays on blue side of the field', () => {
    const path = planPath(nodes, edges, 'blue_shoot_near', 'blue_base', 'blue');
    for (const nodeId of path) {
      expect(isOpponentNodeId(nodeId, 'blue')).toBe(false);
    }
    expect(path).not.toContain('center');
  });

  it('red base path stays on red side of the field', () => {
    const path = planPath(nodes, edges, 'red_shoot_near', 'red_base', 'red');
    for (const nodeId of path) {
      expect(isOpponentNodeId(nodeId, 'red')).toBe(false);
    }
    expect(path).not.toContain('center');
  });
});
