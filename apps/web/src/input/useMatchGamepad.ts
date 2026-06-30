import { useEffect, useRef } from 'react';
import { isPageVisible } from '../match/page-visible';

/** W3C Standard Gamepad: Select/Share/View (PS Share, Xbox View). */
export const GAMEPAD_MATCH_RESET_BUTTON = 8;
/** W3C Standard Gamepad: Start/Options/Menu (PS Options, Xbox Start). */
export const GAMEPAD_MATCH_START_BUTTON = 9;

export interface MatchGamepadActions {
  locked: boolean;
  canInit: boolean;
  canStartAuto: boolean;
  canPause: boolean;
  onInit: () => void;
  onStartAuto: () => void;
  onPauseToggle: () => void;
  onReset: () => void;
}

function readActiveGamepad(): Gamepad | null {
  const pads = navigator.getGamepads?.();
  if (!pads) return null;
  for (const pad of pads) {
    if (pad?.connected) return pad;
  }
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function buttonPressed(pad: Gamepad, index: number): boolean {
  return Boolean(pad.buttons[index]?.pressed);
}

/**
 * Match controls on the menu face buttons:
 * - Start/Options: INIT → START AUTO → pause/resume toggle
 * - Share/Select: reset field
 */
export function useMatchGamepad(actions: MatchGamepadActions, enabled = true): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const prevRef = useRef({ start: false, reset: false });

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      if (!isPageVisible()) {
        idleTimer = setTimeout(poll, 250);
        return;
      }
      const pad = readActiveGamepad();
      const prev = prevRef.current;
      const startNow = pad ? buttonPressed(pad, GAMEPAD_MATCH_START_BUTTON) : false;
      const resetNow = pad ? buttonPressed(pad, GAMEPAD_MATCH_RESET_BUTTON) : false;
      const startEdge = startNow && !prev.start;
      const resetEdge = resetNow && !prev.reset;
      prev.start = startNow;
      prev.reset = resetNow;

      if (startEdge || resetEdge) {
        const active = document.activeElement;
        if (isEditableTarget(active)) {
          raf = requestAnimationFrame(poll);
          return;
        }
      }

      const act = actionsRef.current;
      if (!act.locked) {
        if (resetEdge) {
          act.onReset();
        } else if (startEdge) {
          if (act.canInit) {
            act.onInit();
          } else if (act.canStartAuto) {
            act.onStartAuto();
          } else if (act.canPause) {
            act.onPauseToggle();
          }
        }
      }

      raf = requestAnimationFrame(poll);
    };

    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      if (idleTimer !== null) clearTimeout(idleTimer);
    };
  }, [enabled]);
}
