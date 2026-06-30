import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDriveInputSampler,
  sampleDriveInput,
  setDriveKeybinds,
  type ControlSource,
  type DriveInputDebug,
  type DriveInputSamplerState,
} from './drive-input-sampler';
import { loadDriveKeybinds, type DriveKeybinds } from './drive-keybinds';

function driveDebugEqual(a: DriveInputDebug, b: DriveInputDebug): boolean {
  return (
    a.forward === b.forward &&
    a.strafe === b.strafe &&
    a.turn === b.turn &&
    a.intake === b.intake &&
    a.shoot === b.shoot &&
    a.gate === b.gate &&
    a.rawForward === b.rawForward &&
    a.rawStrafe === b.rawStrafe &&
    a.rawTurn === b.rawTurn &&
    a.padAxes[0] === b.padAxes[0] &&
    a.padAxes[1] === b.padAxes[1] &&
    a.padAxes[2] === b.padAxes[2] &&
    a.padAxes[3] === b.padAxes[3]
  );
}

export function useDriveInput(driveEnabled: boolean, listenForInput = false) {
  const samplerRef = useRef<DriveInputSamplerState>(createDriveInputSampler(loadDriveKeybinds()));
  const [controlSource, setControlSource] = useState<ControlSource>('none');
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [driveDebug, setDriveDebug] = useState<DriveInputDebug | null>(null);

  const listen = driveEnabled || listenForInput;

  useEffect(() => {
    if (!listen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      samplerRef.current.pressedCodes.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      samplerRef.current.pressedCodes.delete(e.code);
    };
    const onBlur = () => {
      samplerRef.current.pressedCodes.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [listen]);

  const sampleRef = useRef(() => sampleDriveInput(samplerRef.current));
  const hudRef = useRef<{ debug: DriveInputDebug; source: ControlSource; connected: boolean } | null>(
    null,
  );

  const updateHud = useCallback((debug: DriveInputDebug, source: ControlSource, connected: boolean) => {
    const prev = hudRef.current;
    if (
      prev &&
      prev.source === source &&
      prev.connected === connected &&
      driveDebugEqual(prev.debug, debug)
    ) {
      return;
    }
    hudRef.current = { debug, source, connected };
    setDriveDebug(debug);
    setControlSource(source);
    setGamepadConnected(connected);
  }, []);

  return {
    samplerRef,
    sampleInput: sampleRef,
    updateHud,
    controlSource,
    gamepadConnected,
    driveDebug,
    applyKeybinds: (keybinds: DriveKeybinds) => {
      setDriveKeybinds(samplerRef.current, keybinds);
    },
    setInjectInput: (input: import('@ftc-sim/robot').HolonomicInput | null) => {
      samplerRef.current.injectInput = input;
    },
    resetGamepad: () => {
      samplerRef.current.smoothed = { forward: 0, strafe: 0, turn: 0 };
    },
  };
}
