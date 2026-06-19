import { useCallback, useRef, useState, type RefObject } from 'react';
import { MatchClock, type MatchSnapshot } from '@ftc-sim/match';

export interface UseMatchClockResult {
  snapshot: MatchSnapshot;
  allowsDrive: boolean;
  initMatch: () => void;
  startAuto: () => void;
  start: () => void;
  startTeleop: () => void;
  startInfinitePractice: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  endMatch: () => void;
  tick: (dt: number) => void;
  syncUi: () => void;
  clockRef: RefObject<MatchClock>;
}

export function useMatchClock(): UseMatchClockResult {
  const clockRef = useRef<MatchClock>(new MatchClock());
  const [snapshot, setSnapshot] = useState<MatchSnapshot>(() => clockRef.current.snapshot());

  const syncUi = useCallback(() => {
    setSnapshot(clockRef.current.snapshot());
  }, []);

  const initMatch = useCallback(() => {
    clockRef.current.initMatch();
    syncUi();
  }, [syncUi]);

  const startAuto = useCallback(() => {
    clockRef.current.startAuto();
    syncUi();
  }, [syncUi]);

  const start = useCallback(() => {
    clockRef.current.start();
    syncUi();
  }, [syncUi]);

  const startTeleop = useCallback(() => {
    clockRef.current.startTeleop();
    syncUi();
  }, [syncUi]);

  const startInfinitePractice = useCallback(() => {
    clockRef.current.startInfinitePractice();
    syncUi();
  }, [syncUi]);

  const pause = useCallback(() => {
    clockRef.current.pause();
    syncUi();
  }, [syncUi]);

  const resume = useCallback(() => {
    clockRef.current.resume();
    syncUi();
  }, [syncUi]);

  const reset = useCallback(() => {
    clockRef.current.reset();
    syncUi();
  }, [syncUi]);

  const endMatch = useCallback(() => {
    clockRef.current.endMatch();
    syncUi();
  }, [syncUi]);

  const tick = useCallback((dt: number) => {
    clockRef.current.tick(dt);
  }, []);

  return {
    snapshot,
    allowsDrive: snapshot.allowsDrive,
    initMatch,
    startAuto,
    start,
    startTeleop,
    startInfinitePractice,
    pause,
    resume,
    reset,
    endMatch,
    tick,
    syncUi,
    clockRef,
  };
}
