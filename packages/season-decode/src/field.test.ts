import { describe, expect, it } from 'vitest';
import {
  getBarrierBodies,
  getBodyOutline,
  getDebugZones,
  getLaunchZones,
  getStartPose,
  getZoneById,
  pointInPolygon,
  validateFieldDefinition,
} from '@ftc-sim/field';
import { getDecodeField } from './index.js';

describe('decode field', () => {
  it('loads pedro field definition with goals and launch zones', () => {
    const field = getDecodeField();
    validateFieldDefinition(field);
    expect(field.coordinateSystem).toBe('pedro');
    expect(field.fieldSizeInches).toBe(144);

    const barriers = getBarrierBodies(field);
    expect(barriers.map((b) => b.id).sort()).toEqual(['blue_goal', 'red_goal']);

    const launchZones = getLaunchZones(field);
    expect(launchZones.map((z) => z.id).sort()).toEqual(['far_launch', 'near_launch']);
    expect(launchZones.every((z) => z.points === 3)).toBe(true);
  });

  it('has goal outlines in pedro inches', () => {
    const field = getDecodeField();
    const redGoal = field.bodies.find((b) => b.id === 'red_goal')!;

    expect(getBodyOutline(redGoal).length).toBeGreaterThanOrEqual(4);
  });

  it('blue goal uses x=6 vertex on goal inner edge', () => {
    const field = getDecodeField();
    const blueGoal = field.bodies.find((b) => b.id === 'blue_goal')!;
    expect(blueGoal.vertices?.some((v) => v.x === 6 && v.y === 70)).toBe(true);
  });

  it('includes scoring debug zones with ramp capacity', () => {
    const field = getDecodeField();
    const debug = getDebugZones(field);
    expect(debug.map((z) => z.id).sort()).toEqual([
      'blue_base',
      'blue_gate',
      'blue_goal_basin',
      'blue_ramp',
      'blue_secret_tunnel',
      'red_base',
      'red_gate',
      'red_goal_basin',
      'red_ramp',
      'red_secret_tunnel',
    ]);
    const redRamp = getZoneById(field, 'red_ramp');
    expect(redRamp?.capacity).toBe(9);
  });

  it('goal basins contain interior scoring landmarks', () => {
    const field = getDecodeField();
    const redBasin = getZoneById(field, 'red_goal_basin')!;
    const blueBasin = getZoneById(field, 'blue_goal_basin')!;
    expect(pointInPolygon({ x: 132, y: 130 }, redBasin.polygon)).toBe(true);
    expect(pointInPolygon({ x: 12, y: 130 }, blueBasin.polygon)).toBe(true);
  });

  it('gate zones contain gate vertices', () => {
    const field = getDecodeField();
    const redGate = getZoneById(field, 'red_gate')!;
    const blueGate = getZoneById(field, 'blue_gate')!;
    expect(pointInPolygon({ x: 135, y: 70 }, redGate.polygon)).toBe(true);
    expect(pointInPolygon({ x: 9, y: 70 }, blueGate.polygon)).toBe(true);
  });

  it('start poses exist for each alliance', () => {
    const field = getDecodeField();
    expect(getStartPose(field, 'blue_near').x).toBeLessThan(72);
    expect(getStartPose(field, 'red_near').x).toBeGreaterThan(72);
  });
});
