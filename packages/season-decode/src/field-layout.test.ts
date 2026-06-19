import { describe, expect, it } from 'vitest';
import {
  BLUE_SPIKE_SEAM_X,
  getMatchArtifactStaging,
  RED_SPIKE_SEAM_X,
} from './field-layout.js';

describe('getMatchArtifactStaging', () => {
  const staging = getMatchArtifactStaging();

  it('stages 24 artifacts total', () => {
    expect(staging).toHaveLength(24);
    expect(staging.map((a) => a.id)).toEqual(
      Array.from({ length: 24 }, (_, i) => `artifact_${i}`),
    );
  });

  it('blue spike row y=36: center at (24,36), colors PPG west to east', () => {
    const row = staging.filter((a) => a.source === 'blue_spike_y36');
    expect(row).toHaveLength(3);
    const byX = [...row].sort((a, b) => a.pose.x - b.pose.x);
    expect(byX.map((a) => a.pose.x)).toEqual([19, 24, 29]);
    expect(byX.every((a) => a.pose.y === 36)).toBe(true);
    expect(byX.map((a) => a.color)).toEqual(['purple', 'purple', 'green']);
    expect(byX[1]!.pose.x).toBe(BLUE_SPIKE_SEAM_X);
  });

  it('red spike row y=36: center at (120,36), mirrored colors', () => {
    const row = staging.filter((a) => a.source === 'red_spike_y36');
    expect(row).toHaveLength(3);
    const byX = [...row].sort((a, b) => a.pose.x - b.pose.x);
    expect(byX.map((a) => a.pose.x)).toEqual([115, 120, 125]);
    expect(byX.map((a) => a.color)).toEqual(['green', 'purple', 'purple']);
    expect(byX[1]!.pose.x).toBe(RED_SPIKE_SEAM_X);
  });

  it('blue human player vertical spike: PGP at (5,5/10/15)', () => {
    const row = staging.filter((a) => a.source === 'blue_human_player');
    expect(row).toHaveLength(3);
    const byY = [...row].sort((a, b) => a.pose.y - b.pose.y);
    expect(byY.map((a) => a.pose.y)).toEqual([5, 10, 15]);
    expect(byY.every((a) => a.pose.x === 5)).toBe(true);
    expect(byY.map((a) => a.color)).toEqual(['purple', 'green', 'purple']);
  });
});
