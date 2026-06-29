export {
  DEFAULT_SIM_ROBOT_CONFIG,
  DEFAULT_MECHANISM_TIMING,
  COMPETITIVE_MECHANISM_TIMING,
  COMPETITIVE_ROBOT_DRIVE,
  applyPerformancePreset,
  simRobotConfigFromNet,
  simRobotFootprint,
  simRobotLimits,
  type SimRobotConfig,
  type MechanismTimingConfig,
  type PerformancePresetId,
} from '@ftc-sim/session';

export interface SimRobotPreset {
  id: string;
  label: string;
}

export const SIM_ROBOT_PRESETS: SimRobotPreset[] = [{ id: 'mecanum-default', label: 'Mecanum (default)' }];
