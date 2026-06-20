import type { DriveFrame } from '@ftc-sim/robot';

export interface DriveSettings {
  driveFrame: DriveFrame;
}

const STORAGE_KEY = 'ftc-sim.drive-settings.v1';

export const DEFAULT_DRIVE_SETTINGS: DriveSettings = {
  driveFrame: 'robot',
};

export function loadDriveSettings(): DriveSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_DRIVE_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DRIVE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DriveSettings>;
    const driveFrame = parsed.driveFrame === 'field' ? 'field' : 'robot';
    return { driveFrame };
  } catch {
    return { ...DEFAULT_DRIVE_SETTINGS };
  }
}

export function saveDriveSettings(settings: DriveSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
