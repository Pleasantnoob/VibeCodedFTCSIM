import type { DriveFrame } from '@ftc-sim/robot';
import { loadPlayerSettings, patchPlayerSettings, type PlayerSettings } from './player-settings';

export interface DriveSettings {
  driveFrame: DriveFrame;
}

export const DEFAULT_DRIVE_SETTINGS: DriveSettings = {
  driveFrame: 'field',
};

export function loadDriveSettings(): DriveSettings {
  const { driveFrame } = loadPlayerSettings();
  return { driveFrame };
}

export function saveDriveSettings(settings: DriveSettings): void {
  patchPlayerSettings({ driveFrame: settings.driveFrame });
}

export type { PlayerSettings };
