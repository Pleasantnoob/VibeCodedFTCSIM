export type DriveAction =
  | 'forward'
  | 'backward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'brake'
  | 'intake'
  | 'shoot';

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
};
