import type { NetRobotConfig } from '@ftc-sim/net';
import type { KinematicLimits, RobotFootprint } from '@ftc-sim/robot';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';

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

export function simRobotConfigFromNet(net: NetRobotConfig): SimRobotConfig {
  return {
    presetId: net.presetId ?? DEFAULT_SIM_ROBOT_CONFIG.presetId,
    maxVelocity: net.maxVelocity,
    maxAngularVelocity: net.maxAngularVelocity,
    maxAcceleration: net.maxAcceleration,
    maxAngularAcceleration: net.maxAngularAcceleration,
    mass: net.mass,
    footprintWidth: net.footprintWidth,
    footprintLength: net.footprintLength,
  };
}

export function netRobotConfigFromSim(sim: SimRobotConfig): NetRobotConfig {
  return {
    presetId: sim.presetId,
    maxVelocity: sim.maxVelocity,
    maxAngularVelocity: sim.maxAngularVelocity,
    maxAcceleration: sim.maxAcceleration,
    maxAngularAcceleration: sim.maxAngularAcceleration,
    mass: sim.mass,
    footprintWidth: sim.footprintWidth,
    footprintLength: sim.footprintLength,
  };
}
