import type { HolonomicInput } from '@ftc-sim/robot';
import type { MechanismCommand } from '@ftc-sim/mechanisms';
import {
  DEFAULT_DRIVE_KEYBINDS,
  isActionPressed,
  type DriveKeybinds,
} from './drive-keybinds';

const AXIS_DEADZONE = 0.15;
const TURN_DEADZONE = 0.15;
const INPUT_SMOOTH = 0.35;
const INPUT_SNAP = 0.04;
const TRIGGER_THRESHOLD = 0.45;
const INTAKE_THRESHOLD = 0.45;

export type ControlSource = 'none' | 'keyboard' | 'gamepad';

export interface DriveInputDebug {
  padAxes: [number, number, number, number];
  rawForward: number;
  rawStrafe: number;
  rawTurn: number;
  forward: number;
  strafe: number;
  turn: number;
  source: ControlSource;
  intake: number;
  shoot: boolean;
  gate: boolean;
}

export interface MechanismSample {
  command: MechanismCommand;
  shootEdge: boolean;
  gateEdge: boolean;
  shootHeld: boolean;
}

export interface DriveInputSamplerState {
  pressedCodes: Set<string>;
  keybinds: DriveKeybinds;
  smoothed: HolonomicInput;
  injectInput: HolonomicInput | null;
  gamepadConnected: boolean;
  prevShoot: boolean;
  prevGate: boolean;
}

const ZERO_INPUT: HolonomicInput = { forward: 0, strafe: 0, turn: 0 };

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  const sign = Math.sign(value);
  return sign * ((Math.abs(value) - deadzone) / (1 - deadzone));
}

function readActiveGamepad(): Gamepad | null {
  const pads = navigator.getGamepads?.();
  if (!pads) return null;
  for (const pad of pads) {
    if (pad?.connected) return pad;
  }
  return null;
}

/** v1-style raw axes: deadzone only, no resting calibration. */
export function mapGamepadToDrive(pad: Gamepad): {
  forward: number;
  strafe: number;
  turn: number;
  padAxes: [number, number, number, number];
} {
  const padAxes: [number, number, number, number] = [
    pad.axes[0] ?? 0,
    pad.axes[1] ?? 0,
    pad.axes[2] ?? 0,
    pad.axes[3] ?? 0,
  ];
  // Right-stick X: negate active axis (FTC/Nintendo convention on axis 3).
  const useAxis3 = Math.abs(padAxes[3]) >= Math.abs(padAxes[2]);
  const turn = useAxis3 ? -padAxes[3] : -padAxes[2];
  return {
    forward: -(padAxes[1]),
    strafe: -(padAxes[0]),
    turn,
    padAxes,
  };
}

function keyboardInput(codes: Set<string>, keybinds: DriveKeybinds): HolonomicInput {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  if (isActionPressed(codes, 'forward', keybinds)) forward += 1;
  if (isActionPressed(codes, 'backward', keybinds)) forward -= 1;
  if (isActionPressed(codes, 'strafeLeft', keybinds)) strafe += 1;
  if (isActionPressed(codes, 'strafeRight', keybinds)) strafe -= 1;
  if (isActionPressed(codes, 'turnLeft', keybinds)) turn += 1;
  if (isActionPressed(codes, 'turnRight', keybinds)) turn -= 1;
  const brake =
    isActionPressed(codes, 'brake', keybinds) || codes.has('ShiftRight');
  return { forward, strafe, turn, brake };
}

function smoothInput(prev: HolonomicInput, target: HolonomicInput): HolonomicInput {
  const blend = (from: number, to: number): number => {
    if (to === 0 && Math.abs(from) < INPUT_SNAP) return 0;
    return from + (to - from) * INPUT_SMOOTH;
  };
  return {
    forward: blend(prev.forward, target.forward),
    strafe: blend(prev.strafe, target.strafe),
    turn: blend(prev.turn, target.turn),
  };
}

export function createDriveInputSampler(keybinds: DriveKeybinds = DEFAULT_DRIVE_KEYBINDS): DriveInputSamplerState {
  return {
    pressedCodes: new Set(),
    keybinds: { ...keybinds },
    smoothed: { ...ZERO_INPUT },
    injectInput: null,
    gamepadConnected: false,
    prevShoot: false,
    prevGate: false,
  };
}

function readTriggerButton(pad: Gamepad, buttonIndex: number, axisIndex?: number): number {
  const buttonValue = pad.buttons[buttonIndex]?.value ?? 0;
  const axisValue = axisIndex !== undefined ? (pad.axes[axisIndex] ?? 0) : 0;
  const value = Math.max(buttonValue, axisValue > 0 ? axisValue : 0);
  return value >= TRIGGER_THRESHOLD ? value : 0;
}

function sampleMechanism(
  state: DriveInputSamplerState,
  pad: Gamepad | null,
): MechanismSample {
  // Use trigger buttons only — axis fallbacks (e.g. axes[2]) pick up stick drift as intake.
  const intakeFromPad = pad ? readTriggerButton(pad, 6) : 0;
  const shootFromPad = pad ? readTriggerButton(pad, 7, 5) : 0;
  const intakeFromKeys = isActionPressed(state.pressedCodes, 'intake', state.keybinds) ? 1 : 0;
  const shootNow =
    isActionPressed(state.pressedCodes, 'shoot', state.keybinds) || shootFromPad > 0;
  const gateNow =
    isActionPressed(state.pressedCodes, 'gate', state.keybinds) || Boolean(pad?.buttons[1]?.pressed);
  const shootEdge = shootNow && !state.prevShoot;
  const gateEdge = gateNow && !state.prevGate;
  state.prevShoot = shootNow;
  state.prevGate = gateNow;

  const intake = intakeFromKeys > 0 ? 1 : intakeFromPad >= INTAKE_THRESHOLD ? intakeFromPad : 0;
  return {
    command: {
      intake,
      shoot: shootEdge,
      gate: gateNow,
    },
    shootEdge,
    gateEdge,
    shootHeld: shootNow,
  };
}

export function sampleDriveInput(state: DriveInputSamplerState): {
  input: HolonomicInput;
  debug: DriveInputDebug;
  mechanism: MechanismSample;
  source: ControlSource;
} {
  const pad = readActiveGamepad();
  state.gamepadConnected = pad !== null;
  const mechanism = sampleMechanism(state, pad);

  if (state.injectInput) {
    const input = state.injectInput;
    return {
      input,
      mechanism,
      source: 'gamepad',
      debug: {
        padAxes: [0, 0, 0, 0],
        rawForward: input.forward,
        rawStrafe: input.strafe,
        rawTurn: input.turn,
        forward: input.forward,
        strafe: input.strafe,
        turn: input.turn,
        source: 'gamepad',
        intake: mechanism.command.intake ?? 0,
        shoot: mechanism.command.shoot ?? false,
        gate: mechanism.command.gate ?? false,
      },
    };
  }

  if (pad) {
    const mapped = mapGamepadToDrive(pad);
    const target = {
      forward: applyDeadzone(mapped.forward, AXIS_DEADZONE),
      strafe: applyDeadzone(mapped.strafe, AXIS_DEADZONE),
      turn: applyDeadzone(mapped.turn, TURN_DEADZONE),
    };
    state.smoothed = smoothInput(state.smoothed, target);
    const brake = Boolean(pad.buttons[4]?.pressed);
    const input = { ...state.smoothed, brake };

    return {
      input,
      mechanism,
      source: 'gamepad',
      debug: {
        padAxes: mapped.padAxes,
        rawForward: mapped.forward,
        rawStrafe: mapped.strafe,
        rawTurn: mapped.turn,
        forward: input.forward,
        strafe: input.strafe,
        turn: input.turn,
        source: 'gamepad',
        intake: mechanism.command.intake ?? 0,
        shoot: mechanism.command.shoot ?? false,
        gate: mechanism.command.gate ?? false,
      },
    };
  }

  state.smoothed = { ...ZERO_INPUT };
  const kb = keyboardInput(state.pressedCodes, state.keybinds);
  const hasKb = kb.forward !== 0 || kb.strafe !== 0 || kb.turn !== 0 || kb.brake;
  return {
    input: hasKb || kb.brake ? kb : ZERO_INPUT,
    mechanism,
    source: hasKb ? 'keyboard' : 'none',
    debug: {
      padAxes: [0, 0, 0, 0],
      rawForward: kb.forward,
      rawStrafe: kb.strafe,
      rawTurn: kb.turn,
      forward: kb.forward,
      strafe: kb.strafe,
      turn: kb.turn,
      source: hasKb ? 'keyboard' : 'none',
      intake: mechanism.command.intake ?? 0,
      shoot: mechanism.command.shoot ?? false,
      gate: mechanism.command.gate ?? false,
    },
  };
}

export function setDriveKeybinds(state: DriveInputSamplerState, keybinds: DriveKeybinds): void {
  state.keybinds = { ...keybinds };
}

export function resetGamepadCalibration(state: DriveInputSamplerState): void {
  state.smoothed = { ...ZERO_INPUT };
}

/** True when keyboard or gamepad has active drive axes (for AUTO takeover). */
export function hasActiveDriveInput(state: DriveInputSamplerState): boolean {
  if (state.injectInput) {
    const i = state.injectInput;
    return Math.abs(i.forward) + Math.abs(i.strafe) + Math.abs(i.turn) > 0.05;
  }

  const pad = readActiveGamepad();
  if (pad) {
    const mapped = mapGamepadToDrive(pad);
    return (
      applyDeadzone(mapped.forward, AXIS_DEADZONE) !== 0 ||
      applyDeadzone(mapped.strafe, AXIS_DEADZONE) !== 0 ||
      applyDeadzone(mapped.turn, TURN_DEADZONE) !== 0
    );
  }

  const kb = keyboardInput(state.pressedCodes, state.keybinds);
  return kb.forward !== 0 || kb.strafe !== 0 || kb.turn !== 0;
}
