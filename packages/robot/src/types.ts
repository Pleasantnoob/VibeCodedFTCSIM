import type { Pose, Vector2 } from '@ftc-sim/field';

export type ControlSource = 'human' | 'none';

export interface HolonomicInput {
  forward: number;
  strafe: number;
  turn: number;
  /** Hold brake (bumper / Shift): active resist motion like DcMotor BRAKE. */
  brake?: boolean;
  /** Strong decel at path end to prevent overshoot (AUTO only). */
  endpointBrake?: boolean;
}

export interface KinematicLimits {
  maxVelocity: number;
  maxAngularVelocity: number;
}

export interface RobotFootprint {
  width: number;
  length: number;
}

export type DriveFrame = 'field' | 'robot';

export interface KinematicRobotConfig {
  footprint: RobotFootprint;
  limits: KinematicLimits;
  /** Field-centric: stick directions map to the field, not robot heading. */
  driveFrame?: 'field' | 'robot';
}

export const DEFAULT_KINEMATIC_ROBOT: KinematicRobotConfig = {
  footprint: { width: 18, length: 18 },
  limits: { maxVelocity: 50, maxAngularVelocity: 4 },
  driveFrame: 'field',
};

export interface KinematicRobotState {
  pose: Pose;
  speed: number;
  controlSource: ControlSource;
}

export type { Pose, Vector2 };
