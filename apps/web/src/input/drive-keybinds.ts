import { loadPlayerSettings, patchPlayerSettings } from './player-settings';
import {
  DEFAULT_DRIVE_KEYBINDS,
  DRIVE_ACTION_LABELS,
  type DriveAction,
  type DriveKeybinds,
} from './drive-keybind-defaults';

export type { DriveAction, DriveKeybinds };
export { DEFAULT_DRIVE_KEYBINDS, DRIVE_ACTION_LABELS };

const ARROW_ALIASES: Partial<Record<DriveAction, string[]>> = {
  forward: ['ArrowUp'],
  backward: ['ArrowDown'],
  strafeLeft: ['ArrowLeft'],
  strafeRight: ['ArrowRight'],
};

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

export function loadDriveKeybinds(): DriveKeybinds {
  return { ...loadPlayerSettings().keybinds };
}

export function saveDriveKeybinds(bindings: DriveKeybinds): void {
  patchPlayerSettings({ keybinds: bindings });
}

export function isActionPressed(codes: Set<string>, action: DriveAction, bindings: DriveKeybinds): boolean {
  if (codes.has(bindings[action])) return true;
  const aliases = ARROW_ALIASES[action];
  return aliases?.some((code) => codes.has(code)) ?? false;
}

export function resetDriveKeybinds(): DriveKeybinds {
  const defaults = { ...DEFAULT_DRIVE_KEYBINDS };
  saveDriveKeybinds(defaults);
  return defaults;
}
