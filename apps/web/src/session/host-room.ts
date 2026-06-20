import type { HostRoomSettings } from '@ftc-sim/net';
import type { SimRobotConfig } from '../robot/robot-config';

export function buildHostRoomSettings(
  robot: SimRobotConfig,
  robotPreload: boolean,
  teamLabel?: string,
): HostRoomSettings {
  const trimmed = teamLabel?.trim();
  return {
    robotPreload,
    teamLabel: trimmed || undefined,
    robot: {
      presetId: robot.presetId,
      maxVelocity: robot.maxVelocity,
      maxAngularVelocity: robot.maxAngularVelocity,
      maxAcceleration: robot.maxAcceleration,
      maxAngularAcceleration: robot.maxAngularAcceleration,
      mass: robot.mass,
      footprintWidth: robot.footprintWidth,
      footprintLength: robot.footprintLength,
    },
  };
}
