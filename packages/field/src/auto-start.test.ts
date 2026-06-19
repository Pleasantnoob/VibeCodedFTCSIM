import { describe, expect, it } from 'vitest';
import {
  checkAutoBoundaryViolation,
  touchesStartPerimeter,
  validateAutoStartPose,
} from './auto-start.js';
import { getStartPose } from './field-loader.js';
import type { FieldDefinition } from './types.js';
import fieldJson from '../../season-decode/field.json' with { type: 'json' };

const FOOTPRINT = { width: 18, length: 18 };

const minimalField: FieldDefinition = {
  season: 'decode',
  version: 'test',
  fieldSizeInches: 144,
  coordinateSystem: 'pedro',
  bodies: [
    {
      id: 'blue_goal',
      type: 'static',
      shape: 'polygon',
      vertices: [
        { x: 6, y: 119 },
        { x: 25, y: 144 },
        { x: 0, y: 144 },
        { x: 0, y: 70 },
        { x: 6, y: 70 },
      ],
      material: { friction: 0.6 },
    },
    {
      id: 'red_goal',
      type: 'static',
      shape: 'polygon',
      vertices: [
        { x: 144, y: 70 },
        { x: 144, y: 144 },
        { x: 120, y: 144 },
        { x: 138, y: 119 },
        { x: 138, y: 70 },
      ],
      material: { friction: 0.6 },
    },
  ],
  zones: [
    {
      id: 'near_launch',
      type: 'launch_zone',
      polygon: [
        { x: 0, y: 144 },
        { x: 72, y: 72 },
        { x: 144, y: 144 },
      ],
    },
    {
      id: 'far_launch',
      type: 'launch_zone',
      polygon: [
        { x: 48, y: 0 },
        { x: 72, y: 24 },
        { x: 96, y: 0 },
      ],
    },
  ],
  startPoses: {
    blue_near: { x: 12, y: 10, heading: Math.PI / 4 },
    red_near: { x: 132, y: 10, heading: (3 * Math.PI) / 4 },
  },
  gamePieces: [],
};

describe('auto-start validation', () => {
  it('accepts blue_near and red_near default poses', () => {
    const field = fieldJson as FieldDefinition;
    const blue = validateAutoStartPose(
      getStartPose(field, 'blue_near'),
      'blue',
      field,
      FOOTPRINT,
    );
    const red = validateAutoStartPose(
      getStartPose(field, 'red_near'),
      'red',
      field,
      FOOTPRINT,
    );
    expect(blue.ok, blue.errors.join('; ')).toBe(true);
    expect(red.ok, red.errors.join('; ')).toBe(true);
  });

  it('rejects blue robot on red half', () => {
    const result = validateAutoStartPose(
      { x: 100, y: 10, heading: 0 },
      'blue',
      minimalField,
      FOOTPRINT,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('blue side'))).toBe(true);
  });

  it('detects AUTO center-line violation', () => {
    expect(checkAutoBoundaryViolation({ x: 80, y: 50, heading: 0 }, 'blue')).toBe(true);
    expect(checkAutoBoundaryViolation({ x: 50, y: 50, heading: 0 }, 'blue')).toBe(false);
    expect(checkAutoBoundaryViolation({ x: 60, y: 50, heading: 0 }, 'red')).toBe(true);
    expect(checkAutoBoundaryViolation({ x: 90, y: 50, heading: 0 }, 'red')).toBe(false);
  });

  it('accepts south-wall-only edge contact without requiring a corner on two walls', () => {
    const southOnly = { x: 72, y: 9, heading: 0 };
    expect(touchesStartPerimeter(southOnly, FOOTPRINT, minimalField)).toBe(true);
    const floating = { x: 72, y: 72, heading: 0 };
    expect(touchesStartPerimeter(floating, FOOTPRINT, minimalField)).toBe(false);
  });
});
