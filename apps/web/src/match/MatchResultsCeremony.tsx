import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MatchSnapshot } from '@ftc-sim/match';
import type { MatchState } from '@ftc-sim/game-decode';
import { MatchResultsOverlay } from './MatchResultsOverlay';
import { scaled16x9Size } from './display-fit';
import {
  MATCH_END_DELAY_MS,
  MATCH_REVEAL_VIDEO_VOLUME,
  MATCH_RESULTS_AUDIO,
  MATCH_WIN_VIDEOS,
  pickBestMatchState,
  resolveMatchOutcome,
  type ResolvedMatchOutcome,
} from './match-results-assets';
import './match-results.css';

type CeremonyPhase = 'idle' | 'delay' | 'video' | 'results';

export interface MatchResultsCeremonyProps {
  snapshot: MatchSnapshot;
  matchGameState: MatchState | null;
  getMatchState?: () => MatchState | null;
  triggerKey?: number;
  audioEnabled?: boolean;
  volume?: number;
  onActiveChange?: (active: boolean) => void;
  eventName?: string;
  matchName?: string;
  redTeams?: [string, string];
  blueTeams?: [string, string];
}

function readLiveMatchState(
  getMatchState: (() => MatchState | null) | undefined,
  fallback: MatchState | null,
): MatchState | null {
  return getMatchState?.() ?? fallback;
}

export function MatchResultsCeremony({
  snapshot,
  matchGameState,
  getMatchState,
  triggerKey = 0,
  audioEnabled = true,
  volume = 0.5,
  onActiveChange,
  eventName = 'FTC Sim',
  matchName = 'Practice Match',
  redTeams = ['-1', '-2'],
  blueTeams = ['-3', '-4'],
}: MatchResultsCeremonyProps) {
  const [phase, setPhase] = useState<CeremonyPhase>('idle');
  const [displayOutcome, setDisplayOutcome] = useState<ResolvedMatchOutcome | null>(null);
  const [resultsSnapshot, setResultsSnapshot] = useState<MatchState | null>(null);
  const [viewportScale, setViewportScale] = useState(1);
  const [frameSize, setFrameSize] = useState({ width: 1920, height: 1080 });

  const prevSnapshotPhaseRef = useRef(snapshot.phase);
  const prevTriggerKeyRef = useRef(triggerKey);
  const matchGameStateRef = useRef(matchGameState);
  const getMatchStateRef = useRef(getMatchState);
  const videoOutcomeRef = useRef(resolveMatchOutcome(matchGameState));
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultsAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoStartedRef = useRef(false);
  const ceremonyActiveRef = useRef(false);

  matchGameStateRef.current = matchGameState;
  getMatchStateRef.current = getMatchState;

  const readLiveState = useCallback(
    () => readLiveMatchState(getMatchStateRef.current, matchGameStateRef.current),
    [],
  );

  const mergeResultsSnapshot = useCallback((live: MatchState | null) => {
    if (!live) return;
    setResultsSnapshot((prev) => pickBestMatchState(prev, live));
  }, []);

  const captureOutcome = useCallback(() => {
    const live = readLiveState();
    if (live) mergeResultsSnapshot(live);
    const resolved = resolveMatchOutcome(live);
    videoOutcomeRef.current = resolved;
    setDisplayOutcome(resolved);
    return resolved;
  }, [readLiveState, mergeResultsSnapshot]);

  const setCeremonyActive = useCallback(
    (active: boolean) => {
      ceremonyActiveRef.current = active;
      onActiveChange?.(active);
    },
    [onActiveChange],
  );

  const playResultsSting = useCallback(() => {
    if (!audioEnabled) return;
    let clip = resultsAudioRef.current;
    if (!clip) {
      clip = new Audio(MATCH_RESULTS_AUDIO);
      clip.preload = 'auto';
      resultsAudioRef.current = clip;
    }
    clip.volume = volume;
    clip.currentTime = 0;
    void clip.play().catch(() => {
      /* missing asset or autoplay block */
    });
  }, [audioEnabled, volume]);

  const beginResultsScreen = useCallback(() => {
    captureOutcome();
    setPhase('results');
    playResultsSting();
  }, [captureOutcome, playResultsSting]);

  const beginResultsScreenRef = useRef(beginResultsScreen);
  beginResultsScreenRef.current = beginResultsScreen;

  const startCeremony = useCallback(() => {
    if (ceremonyActiveRef.current) return;
    setCeremonyActive(true);
    videoStartedRef.current = false;
    captureOutcome();
    setPhase('delay');
  }, [captureOutcome, setCeremonyActive]);

  const dismiss = useCallback(() => {
    setCeremonyActive(false);
    videoStartedRef.current = false;
    setPhase('idle');
    setResultsSnapshot(null);
    setDisplayOutcome(null);
    videoRef.current?.pause();
    if (resultsAudioRef.current) {
      resultsAudioRef.current.pause();
      resultsAudioRef.current.currentTime = 0;
    }
  }, [setCeremonyActive]);

  useEffect(() => {
    const prev = prevSnapshotPhaseRef.current;
    prevSnapshotPhaseRef.current = snapshot.phase;

    if (prev === 'teleop' && snapshot.phase === 'post') {
      startCeremony();
    }
  }, [snapshot.phase, startCeremony]);

  useEffect(() => {
    if (triggerKey === prevTriggerKeyRef.current) return;
    prevTriggerKeyRef.current = triggerKey;
    if (triggerKey > 0 && snapshot.phase === 'post') {
      startCeremony();
    }
  }, [triggerKey, snapshot.phase, startCeremony]);

  useEffect(() => {
    if (snapshot.phase !== 'post' && ceremonyActiveRef.current) {
      dismiss();
    }
  }, [snapshot.phase, dismiss]);

  useEffect(() => {
    if (phase !== 'delay') return;
    const timer = window.setTimeout(() => setPhase('video'), MATCH_END_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'video') {
      videoStartedRef.current = false;
      return;
    }

    const video = videoRef.current;
    if (!video || videoStartedRef.current) return;

    videoStartedRef.current = true;

    const startPlayback = () => {
      video.volume = MATCH_REVEAL_VIDEO_VOLUME;
      video.currentTime = 0;
      void video.play().catch(() => {
        beginResultsScreenRef.current();
      });
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      startPlayback();
      return;
    }

    video.addEventListener('loadeddata', startPlayback, { once: true });
    return () => video.removeEventListener('loadeddata', startPlayback);
  }, [phase]);

  useEffect(() => {
    if (phase === 'idle') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase === 'results') {
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, dismiss]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const viewport = viewportRef.current;
    if (!shell || !viewport || phase === 'idle') return;

    const updateScale = () => {
      const rect = shell.getBoundingClientRect();
      const sized = scaled16x9Size(rect.width, rect.height);
      setViewportScale(sized.scale);
      setFrameSize({ width: sized.width, height: sized.height });
    };

    updateScale();
    requestAnimationFrame(updateScale);
    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [phase]);

  if (phase === 'idle') return null;

  const videoSrc = MATCH_WIN_VIDEOS[videoOutcomeRef.current.outcome];
  const outcome = displayOutcome ?? resolveMatchOutcome(readLiveMatchState(getMatchState, resultsSnapshot ?? matchGameState));

  return (
    <div ref={shellRef} className="match-results-ceremony" role="presentation">
      <div
        className="match-results-ceremony__frame"
        style={{ width: frameSize.width, height: frameSize.height }}
      >
        <div
          ref={viewportRef}
          className="match-results-ceremony__viewport"
          style={{ transform: `scale(${viewportScale})` }}
        >
        {phase === 'video' ? (
          <video
            key={videoSrc}
            ref={videoRef}
            className="matchResultVideo"
            src={videoSrc}
            playsInline
            preload="auto"
            onEnded={() => beginResultsScreenRef.current()}
            onError={() => beginResultsScreenRef.current()}
          />
        ) : null}

        {phase === 'results' ? (
          <MatchResultsOverlay
            outcome={outcome}
            eventName={eventName}
            matchName={matchName}
            redTeams={redTeams}
            blueTeams={blueTeams}
          />
        ) : null}
        </div>
      </div>

      <div className="match-results-ceremony__controls">
        {phase === 'results' ? (
          <button
            type="button"
            className="match-results-ceremony__btn"
            onClick={(event) => {
              event.stopPropagation();
              dismiss();
            }}
          >
            Dismiss
          </button>
        ) : null}
        {phase === 'video' || phase === 'delay' ? (
          <button
            type="button"
            className="match-results-ceremony__btn"
            onClick={(event) => {
              event.stopPropagation();
              if (phase === 'delay') setPhase('video');
              else beginResultsScreenRef.current();
            }}
          >
            Skip
          </button>
        ) : null}
      </div>

      {phase === 'results' ? (
        <div className="match-results-ceremony--dismiss-hint">Esc to dismiss</div>
      ) : null}
    </div>
  );
}
