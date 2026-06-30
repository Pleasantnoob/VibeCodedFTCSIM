import { useEffect, useRef } from 'react';
import {
  ensureDs4HidDevice,
  requestDs4HidDevice,
  setDs4AllianceLightbar,
  syncGamepadAllianceLight,
  type GamepadAlliance,
} from './gamepad-lightbar';

type MatchPhase = 'setup' | 'init' | 'auto' | 'transition' | 'teleop' | 'post';

/**
 * PS4 light bar tint via WebHID.
 * First connection needs one user click (anywhere) or INIT to open the Chrome device picker.
 */
export function useGamepadAllianceLight(
  alliance: GamepadAlliance,
  gamepadConnected: boolean,
  matchPhase?: MatchPhase,
): void {
  const permissionAsked = useRef(false);

  const apply = (force = false) => {
    void setDs4AllianceLightbar(alliance, force);
  };

  useEffect(() => {
    if (!gamepadConnected) return;
    void ensureDs4HidDevice().then((ready) => {
      if (ready) apply(true);
    });
  }, [alliance, gamepadConnected]);

  useEffect(() => {
    if (matchPhase !== 'init') return;
    void requestDs4HidDevice().then((granted) => {
      if (granted) void syncGamepadAllianceLight(alliance);
    });
  }, [alliance, matchPhase]);

  useEffect(() => {
    if (!gamepadConnected) return;
    const onPadConnected = () => {
      void ensureDs4HidDevice().then((ready) => {
        if (ready) apply(true);
      });
    };
    window.addEventListener('gamepadconnected', onPadConnected);
    return () => window.removeEventListener('gamepadconnected', onPadConnected);
  }, [alliance, gamepadConnected]);

  useEffect(() => {
    if (!gamepadConnected || permissionAsked.current) return;
    const onGesture = () => {
      if (permissionAsked.current) return;
      permissionAsked.current = true;
      void requestDs4HidDevice().then((granted) => {
        if (granted) void setDs4AllianceLightbar(alliance, true);
      });
      document.removeEventListener('pointerdown', onGesture, true);
    };
    document.addEventListener('pointerdown', onGesture, true);
    return () => document.removeEventListener('pointerdown', onGesture, true);
  }, [alliance, gamepadConnected]);
}

export async function enablePs4LightbarFromUserGesture(alliance: GamepadAlliance): Promise<boolean> {
  const ok = await requestDs4HidDevice();
  if (ok) await setDs4AllianceLightbar(alliance, true);
  return ok;
}
