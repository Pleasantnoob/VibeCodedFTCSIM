import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_NEAR_SPAWN,
  BLUE_FAR_SPAWN,
  RED_FAR_SPAWN,
  RED_NEAR_SPAWN,
} from './match-robots.js';

describe('practice robot spawns', () => {
  it('red near mirrors blue near across field center', () => {
    expect(RED_NEAR_SPAWN.x).toBeCloseTo(144 - ALLIANCE_NEAR_SPAWN.blue.x, 5);
    expect(RED_NEAR_SPAWN.y).toBeCloseTo(ALLIANCE_NEAR_SPAWN.blue.y, 5);
    expect(RED_NEAR_SPAWN.heading).toBeCloseTo(ALLIANCE_NEAR_SPAWN.blue.heading, 5);
  });

  it('red far mirrors blue far (player spawn)', () => {
    expect(RED_FAR_SPAWN.x).toBeCloseTo(144 - BLUE_FAR_SPAWN.x, 5);
    expect(RED_FAR_SPAWN.y).toBeCloseTo(BLUE_FAR_SPAWN.y, 5);
    expect(RED_FAR_SPAWN.heading).toBeCloseTo(Math.PI - BLUE_FAR_SPAWN.heading, 5);
  });
});
