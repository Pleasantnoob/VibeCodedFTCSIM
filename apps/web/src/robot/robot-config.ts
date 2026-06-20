export {
  DEFAULT_SIM_ROBOT_CONFIG,
  simRobotConfigFromNet,
  simRobotFootprint,
  simRobotLimits,
  type SimRobotConfig,
} from '@ftc-sim/session';

export interface SimRobotPreset {
  id: string;
  label: string;
}

export const SIM_ROBOT_PRESETS: SimRobotPreset[] = [{ id: 'mecanum-default', label: 'Mecanum (default)' }];
