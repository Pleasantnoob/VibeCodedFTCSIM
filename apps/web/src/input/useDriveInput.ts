import { useCallback, useEffect, useRef, useState } from 'react';
import type { HolonomicInput } from '@ftc-sim/robot';
import {
  createDriveInputSampler,
  resetGamepadCalibration,
  sampleDriveInput,
  type ControlSource,
  type DriveInputDebug,
  type DriveInputSamplerState,
} from './drive-input-sampler';

export type { ControlSource, DriveInputDebug };

export function useDriveInput(driveEnabled: boolean, listenForInput = false) {
  const samplerRef = useRef<DriveInputSamplerState>(createDriveInputSampler());
  const [controlSource, setControlSource] = useState<ControlSource>('none');
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [driveDebug, setDriveDebug] = useState<DriveInputDebug | null>(null);

  const listen = driveEnabled || listenForInput;

  useEffect(() => {
    if (!listen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      samplerRef.current.keys.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      samplerRef.current.keys.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
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
    setInjectInput: (input: HolonomicInput | null) => {
      samplerRef.current.injectInput = input;
    },
    resetGamepad: () => {
      resetGamepadCalibration(samplerRef.current);
    },
  };
}
