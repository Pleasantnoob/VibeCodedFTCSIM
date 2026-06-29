import type { Vector2 } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import {
  GATE_CAUTION_BLEND_IN_IN,
  GATE_CAUTION_BLEND_OUT_IN,
} from './drive/field-drive.js';

export interface GateCautionAnchorVisual {
  id: string;
  alliance: Alliance;
  x: number;
  y: number;
  label: string;
}

export interface GateCautionZoneVisual {
  alliance: Alliance;
  innerIn: number;
  outerIn: number;
  wallSegment: [Vector2, Vector2];
  /** Single gate-mouth anchor — turn easing radii are drawn here only. */
  anchor: GateCautionAnchorVisual;
}

const GATE_APPROACH: Record<Alliance, Vector2> = {
  blue: { x: 15, y: 69 },
  red: { x: 129, y: 69 },
};

const GOAL_WALL: Record<Alliance, { x: number; y0: number; y1: number }> = {
  blue: { x: 8, y0: 64, y1: 124 },
  red: { x: 136, y0: 64, y1: 124 },
};

/** Debug overlay: one dashed outer + solid inner ring per alliance at the gate mouth. */
export function gateCautionZones(): GateCautionZoneVisual[] {
  return (['blue', 'red'] as const).map((alliance) => {
    const wall = GOAL_WALL[alliance];
    const gate = GATE_APPROACH[alliance];
    return {
      alliance,
      innerIn: GATE_CAUTION_BLEND_IN_IN,
      outerIn: GATE_CAUTION_BLEND_OUT_IN,
      wallSegment: [
        { x: wall.x, y: wall.y0 },
        { x: wall.x, y: wall.y1 },
      ],
      anchor: {
        id: 'gate_mouth',
        alliance,
        x: gate.x,
        y: gate.y,
        label: `${alliance} turn ease`,
      },
    };
  });
}
