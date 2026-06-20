export type DriveAction =
  | 'forward'
  | 'backward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'brake'
  | 'intake'
  | 'shoot'
  | 'gate';

export type DriveKeybinds = Record<DriveAction, string>;

export const DRIVE_ACTION_LABELS: Record<DriveAction, string> = {
  forward: 'Forward',
  backward: 'Backward',
  strafeLeft: 'Strafe left',
  strafeRight: 'Strafe right',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  brake: 'Brake',
  intake: 'Intake',
  shoot: 'Shoot',
  gate: 'Gate',
};

export const DEFAULT_DRIVE_KEYBINDS: DriveKeybinds = {
  forward: 'KeyW',
  backward: 'KeyS',
  strafeLeft: 'KeyA',
  strafeRight: 'KeyD',
  turnLeft: 'KeyQ',
  turnRight: 'KeyE',
  brake: 'ShiftLeft',
  intake: 'KeyF',
  shoot: 'Space',
  gate: 'KeyB',
};

const STORAGE_KEY = 'ftc-sim.drive-keybinds.v1';

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
  if (typeof localStorage === 'undefined') return { ...DEFAULT_DRIVE_KEYBINDS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DRIVE_KEYBINDS };
    const parsed = JSON.parse(raw) as Partial<DriveKeybinds>;
    return { ...DEFAULT_DRIVE_KEYBINDS, ...parsed };
  } catch {
    return { ...DEFAULT_DRIVE_KEYBINDS };
  }
}

export function saveDriveKeybinds(bindings: DriveKeybinds): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
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
