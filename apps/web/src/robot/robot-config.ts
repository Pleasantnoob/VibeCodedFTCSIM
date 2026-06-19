import type { KinematicLimits, RobotFootprint } from '@ftc-sim/robot';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';

export interface SimRobotPreset {
  id: string;
  label: string;
}

export const SIM_ROBOT_PRESETS: SimRobotPreset[] = [
  { id: 'mecanum-default', label: 'Mecanum (default)' },
];

export interface SimRobotConfig {
  presetId: string;
  maxVelocity: number;
  maxAngularVelocity: number;
  maxAcceleration: number;
  maxAngularAcceleration: number;
  mass: number;
  footprintWidth: number;
  footprintLength: number;
}

export const DEFAULT_SIM_ROBOT_CONFIG: SimRobotConfig = {
  presetId: 'mecanum-default',
  maxVelocity: DEFAULT_KINEMATIC_ROBOT.limits.maxVelocity,
  maxAngularVelocity: DEFAULT_KINEMATIC_ROBOT.limits.maxAngularVelocity,
  maxAcceleration: 48,
  maxAngularAcceleration: 18,
  mass: 10,
  footprintWidth: DEFAULT_KINEMATIC_ROBOT.footprint.width,
  footprintLength: DEFAULT_KINEMATIC_ROBOT.footprint.length,
};

export function simRobotLimits(config: SimRobotConfig): KinematicLimits {
  return {
    maxVelocity: config.maxVelocity,
    maxAngularVelocity: config.maxAngularVelocity,
  };
}

export function simRobotFootprint(config: SimRobotConfig): RobotFootprint {
  return {
    width: config.footprintWidth,
    length: config.footprintLength,
  };
}
