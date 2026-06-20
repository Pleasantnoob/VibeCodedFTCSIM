import { describe, expect, it, vi } from 'vitest';
import type { Pose } from '@ftc-sim/field';
import { resolveDriveInput, type DriveSample } from './drive-resolver.js';

const POSE: Pose = { x: 0, y: 0, heading: 0 };
const LINEAR = { x: 0, y: 0 };
const LIMITS = {
  maxVelocity: 48,
  maxAngularVelocity: 4,
  maxAcceleration: 48,
  maxAngularAcceleration: 18,
};
const SAMPLE: DriveSample = {
  input: { forward: 1, strafe: 0, turn: 0 },
  mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
};

describe('resolveDriveInput', () => {
  it('applies brake hold in auto when follower is not running', () => {
    const result = resolveDriveInput(
      SAMPLE,
      null,
      false,
      'autonomous',
      'auto',
      true,
      null,
      POSE,
      LINEAR,
      0.02,
      LIMITS,
    );
    expect(result.input.brake).toBe(true);
    expect(result.input.forward).toBe(0);
  });

  it('uses follower holonomic input when auto follower is running', () => {
    const follower = {
      isRunning: () => true,
      setPose: vi.fn(),
      setVelocity: vi.fn(),
      updateHolonomic: vi.fn(() => ({ forward: 0.5, strafe: 0.1, turn: 0.05 })),
    };
    const result = resolveDriveInput(
      SAMPLE,
      null,
      false,
      'autonomous',
      'auto',
      true,
      follower,
      POSE,
      LINEAR,
      0.02,
      LIMITS,
    );
    expect(result.input.forward).toBe(0.5);
    expect(result.driveFrame).toBe('robot');
  });

  it('uses teleop sample when allowsDrive is true', () => {
    const result = resolveDriveInput(
      { ...SAMPLE, driveFrame: 'field' },
      null,
      true,
      'human',
      'teleop',
      true,
      null,
      POSE,
      LINEAR,
      0.02,
      LIMITS,
    );
    expect(result.input.forward).toBe(1);
    expect(result.driveFrame).toBe('field');
  });
});
