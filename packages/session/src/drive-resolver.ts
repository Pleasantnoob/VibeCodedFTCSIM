import type { Pose } from '@ftc-sim/field';
import type { ControlSource, MatchPhase } from '@ftc-sim/match';
import type { DriveFrame, HolonomicInput, KinematicLimits } from '@ftc-sim/robot';

const ZERO_INPUT: HolonomicInput = { forward: 0, strafe: 0, turn: 0 };

export interface AutoFollowerLike {
  isRunning(): boolean;
  setPose(pose: Pose): void;
  setVelocity(linear: { x: number; y: number }): void;
  updateHolonomic(dt: number, limits: KinematicLimits): HolonomicInput;
  shouldAutoShoot?(): boolean;
}

export interface DriveSample {
  input: HolonomicInput;
  mechanism: {
    command: { intake?: number; shoot?: boolean; gate?: boolean };
    shootEdge: boolean;
    gateEdge: boolean;
    shootHeld: boolean;
  };
}

export function resolveDriveInput(
  sample: DriveSample,
  injected: HolonomicInput | null | undefined,
  allowsDrive: boolean,
  controlSource: ControlSource,
  phase: MatchPhase,
  matchActive: boolean,
  follower: AutoFollowerLike | null | undefined,
  pose: Pose,
  linear: { x: number; y: number },
  dt: number,
  limits: KinematicLimits,
): { input: HolonomicInput; driveFrame: DriveFrame } {
  if (injected) {
    return { input: injected, driveFrame: 'field' };
  }

  const autoDrive =
    matchActive &&
    controlSource === 'autonomous' &&
    (phase === 'auto' || phase === 'transition') &&
    (follower?.isRunning() ?? false);

  if (autoDrive && follower) {
    follower.setPose(pose);
    follower.setVelocity(linear);
    const input = follower.updateHolonomic(dt, limits);
    return {
      input,
      driveFrame: 'robot',
    };
  }

  if (
    matchActive &&
    controlSource === 'autonomous' &&
    (phase === 'auto' || phase === 'transition')
  ) {
    return {
      input: { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true },
      driveFrame: 'field',
    };
  }

  if (allowsDrive) {
    return { input: sample.input, driveFrame: 'field' };
  }

  return { input: ZERO_INPUT, driveFrame: 'field' };
}
