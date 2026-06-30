import type { NetRobotConfig } from '@ftc-sim/net';
import type { KinematicLimits, RobotFootprint } from '@ftc-sim/robot';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';

export interface MechanismTimingConfig {
  shootHoldIntervalSec: number;
  intakeFullWaitTimeoutSec: number;
  shootEmptyWaitTimeoutSec: number;
  leaveSafetyMarginSec: number;
}

export const DEFAULT_MECHANISM_TIMING: MechanismTimingConfig = {
  shootHoldIntervalSec: 0.2,
  intakeFullWaitTimeoutSec: 3.0,
  shootEmptyWaitTimeoutSec: 1.5,
  leaveSafetyMarginSec: 2.0,
};

export const COMPETITIVE_MECHANISM_TIMING: MechanismTimingConfig = {
  shootHoldIntervalSec: 0.1,
  intakeFullWaitTimeoutSec: 2.0,
  shootEmptyWaitTimeoutSec: 3.5,
  leaveSafetyMarginSec: 2.0,
};

export const COMPETITIVE_ROBOT_DRIVE = {
  maxVelocity: 65,
  maxAcceleration: 80,
  maxAngularVelocity: 6.5,
  maxAngularAcceleration: 28,
} as const;

export type PerformancePresetId = 'stock' | 'competitive' | 'custom';

export interface SimRobotConfig {
  presetId: string;
  performancePreset: PerformancePresetId;
  maxVelocity: number;
  maxAngularVelocity: number;
  maxAcceleration: number;
  maxAngularAcceleration: number;
  mass: number;
  footprintWidth: number;
  footprintLength: number;
  mechanismTiming: MechanismTimingConfig;
}

export const DEFAULT_SIM_ROBOT_CONFIG: SimRobotConfig = {
  presetId: 'mecanum-default',
  performancePreset: 'stock',
  maxVelocity: DEFAULT_KINEMATIC_ROBOT.limits.maxVelocity,
  maxAngularVelocity: 6,
  maxAcceleration: 48,
  maxAngularAcceleration: 26,
  mass: 10,
  footprintWidth: DEFAULT_KINEMATIC_ROBOT.footprint.width,
  footprintLength: DEFAULT_KINEMATIC_ROBOT.footprint.length,
  mechanismTiming: { ...DEFAULT_MECHANISM_TIMING },
};

export function applyPerformancePreset(preset: PerformancePresetId): Partial<SimRobotConfig> {
  if (preset === 'competitive') {
    return {
      performancePreset: 'competitive',
      ...COMPETITIVE_ROBOT_DRIVE,
      mechanismTiming: { ...COMPETITIVE_MECHANISM_TIMING },
    };
  }
  if (preset === 'stock') {
    return {
      performancePreset: 'stock',
      maxVelocity: DEFAULT_KINEMATIC_ROBOT.limits.maxVelocity,
      maxAcceleration: 48,
      maxAngularVelocity: 6,
      maxAngularAcceleration: 26,
      mechanismTiming: { ...DEFAULT_MECHANISM_TIMING },
    };
  }
  return { performancePreset: 'custom' };
}

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
    performancePreset: 'custom',
    maxVelocity: net.maxVelocity,
    maxAngularVelocity: net.maxAngularVelocity,
    maxAcceleration: net.maxAcceleration,
    maxAngularAcceleration: net.maxAngularAcceleration,
    mass: net.mass,
    footprintWidth: net.footprintWidth,
    footprintLength: net.footprintLength,
    mechanismTiming: { ...DEFAULT_MECHANISM_TIMING },
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
