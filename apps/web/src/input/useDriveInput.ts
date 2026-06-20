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

  const updateHud = useCallback((debug: DriveInputDebug, source: ControlSource, connected: boolean) => {
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
