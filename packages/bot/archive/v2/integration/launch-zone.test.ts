import { describe, expect, it } from 'vitest';
import { robotInLaunchZone } from '@ftc-sim/mechanisms';
import { getDecodeField } from '@ftc-sim/season-decode';
import { simRobotFootprint, DEFAULT_SIM_ROBOT_CONFIG } from '@ftc-sim/session';

describe('launch zone positions', () => {
  const field = getDecodeField();
  const footprint = simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);

  it('bot shoot waypoints are inside launch zones', () => {
    const points = [
      { x: 68, y: 10, label: 'blue far shoot' },
      { x: 40, y: 115, label: 'blue near shoot' },
      { x: 76, y: 10, label: 'red far shoot' },
      { x: 104, y: 115, label: 'red near shoot' },
    ];
    for (const point of points) {
      const inZone = robotInLaunchZone(
        { ...point, heading: -Math.PI / 4 },
        footprint,
        field,
      );
      expect(inZone, point.label).toBe(true);
    }
  });
});
