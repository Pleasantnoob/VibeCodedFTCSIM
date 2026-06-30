import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { isPageVisible } from './page-visible';

/** PS4 / DualSense touchpad click — toggle match fullscreen. */
const GAMEPAD_FULLSCREEN_BUTTON = 17;
const GAMEPAD_TOGGLE_COOLDOWN_MS = 450;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useMatchFullscreen(containerRef: RefObject<HTMLElement | null>) {
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const isActive = nativeFullscreen || immersive;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const toggleInFlightRef = useRef(false);

  const syncNative = useCallback(() => {
    setNativeFullscreen(document.fullscreenElement === containerRef.current);
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncNative);
    return () => document.removeEventListener('fullscreenchange', syncNative);
  }, [syncNative]);

  const enter = useCallback(async () => {
    const el = containerRef.current;
    if (!el || isActiveRef.current) return;
    try {
      await el.requestFullscreen();
    } catch {
      setImmersive(true);
    }
  }, [containerRef]);

  const exit = useCallback(async () => {
    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen();
    }
    setImmersive(false);
  }, [containerRef]);

  const toggle = useCallback(async () => {
    if (toggleInFlightRef.current) return;
    toggleInFlightRef.current = true;
    try {
      if (isActiveRef.current) {
        await exit();
      } else {
        await enter();
      }
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [enter, exit]);

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return;

      if (event.key === 'Escape' && immersive) {
        event.preventDefault();
        void exit();
        return;
      }

      if (event.key === 'F11') {
        event.preventDefault();
        void toggle();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [immersive, exit, toggle]);

  useEffect(() => {
    let raf = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let prevPressed = false;
    let cooldownUntil = 0;

    const poll = () => {
      if (!isPageVisible()) {
        idleTimer = setTimeout(poll, 250);
        return;
      }
      const now = performance.now();
      const pads = navigator.getGamepads?.();
      let pressed = false;
      if (pads) {
        for (const gamepad of pads) {
          if (!gamepad?.connected) continue;
          if (gamepad.buttons[GAMEPAD_FULLSCREEN_BUTTON]?.pressed) {
            pressed = true;
            break;
          }
        }
      }

      const edge = pressed && !prevPressed;
      prevPressed = pressed;

      if (
        edge &&
        now >= cooldownUntil &&
        !toggleInFlightRef.current &&
        !isEditableTarget(document.activeElement)
      ) {
        cooldownUntil = now + GAMEPAD_TOGGLE_COOLDOWN_MS;
        void toggleRef.current();
      }

      raf = requestAnimationFrame(poll);
    };

    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      if (idleTimer !== null) clearTimeout(idleTimer);
    };
  }, []);

  return { isActive, enter, exit, toggle, immersive };
}
