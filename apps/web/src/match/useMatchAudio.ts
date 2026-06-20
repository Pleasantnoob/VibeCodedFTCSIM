import { useEffect, useRef } from 'react';
import { matchAudioCues, type MatchAudioCue } from '@ftc-sim/match';
import type { MatchSnapshot } from '@ftc-sim/match';

/** FTC Live v7.5.0 match sounds (install FTC Live once to populate public/ftc-live/audio). */
export const MATCH_AUDIO: Record<MatchAudioCue, string> = {
  countdown: '/ftc-live/audio/3-2-1.wav',
  endAutoWarning: '/ftc-live/audio/endauto_with_warning.wav',
  endMatch: '/ftc-live/audio/endmatch.wav',
  charge: '/ftc-live/audio/charge.wav',
  firebell: '/ftc-live/audio/firebell.wav',
  whistle: '/ftc-live/audio/factwhistle.wav',
};

/** Plays during the user-gesture window to satisfy browser autoplay policy. */
const UNMUTE_AUDIO = '/ftc-live/audio/unmute.wav';

export type { MatchAudioCue };
export { matchAudioCues };

export const DEFAULT_MATCH_AUDIO_VOLUME = 0.5;

const CUE_DEDUPE_MS = 1500;

export interface MatchAudioOptions {
  enabled?: boolean;
  volume?: number;
}

function audioDebugEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('ftc-sim.audio-debug') === '1')
  );
}

let autoplayUnlocked = false;
const sharedCache = new Map<MatchAudioCue, HTMLAudioElement>();
const lastCueAt = new Map<MatchAudioCue, number>();

export function getMatchAudioCache(): Map<MatchAudioCue, HTMLAudioElement> {
  return sharedCache;
}

/** Call synchronously from a click/key handler before playing match sounds. */
export function unlockMatchAudio(cache: Map<MatchAudioCue, HTMLAudioElement> = sharedCache): void {
  if (autoplayUnlocked) return;
  autoplayUnlocked = true;

  const unmute = new Audio(UNMUTE_AUDIO);
  unmute.volume = 0.001;
  unmute.preload = 'auto';
  void unmute.play().catch(() => {});

  for (const src of Object.values(MATCH_AUDIO)) {
    const clip = new Audio(src);
    clip.volume = 0;
    clip.preload = 'auto';
    void clip.play().then(() => {
      clip.pause();
      clip.currentTime = 0;
    }).catch(() => {});
  }

  for (const [cue, src] of Object.entries(MATCH_AUDIO) as [MatchAudioCue, string][]) {
    if (!cache.has(cue)) {
      const clip = new Audio(src);
      clip.preload = 'auto';
      cache.set(cue, clip);
    }
  }
}

function playClip(
  cue: MatchAudioCue,
  cache: Map<MatchAudioCue, HTMLAudioElement>,
  volume: number,
): void {
  const now = performance.now();
  const lastAt = lastCueAt.get(cue);
  if (lastAt != null && now - lastAt < CUE_DEDUPE_MS) {
    return;
  }
  lastCueAt.set(cue, now);

  const src = MATCH_AUDIO[cue];
  let clip = cache.get(cue);
  if (!clip) {
    clip = new Audio(src);
    clip.preload = 'auto';
    cache.set(cue, clip);
  }
  clip.volume = volume;
  clip.currentTime = 0;
  void clip.play().catch((error) => {
    if (audioDebugEnabled()) {
      console.warn('[match-audio] play failed', cue, src, error);
    }
  });
}

export function playMatchAudioCue(
  cue: MatchAudioCue,
  cache: Map<MatchAudioCue, HTMLAudioElement> = sharedCache,
  volume: number = DEFAULT_MATCH_AUDIO_VOLUME,
): void {
  if (!autoplayUnlocked) unlockMatchAudio(cache);
  playClip(cue, cache, volume);
}

/** Play cues between two snapshots (safe to call during a user-gesture handler). */
export function emitMatchAudioCues(
  prev: MatchSnapshot | null,
  next: MatchSnapshot,
  volume: number,
  cache: Map<MatchAudioCue, HTMLAudioElement> = sharedCache,
): void {
  for (const cue of matchAudioCues(prev, next)) {
    playMatchAudioCue(cue, cache, volume);
  }
}

export function useMatchAudio(
  snapshot: MatchSnapshot,
  options: MatchAudioOptions | boolean = true,
): void {
  const { enabled = true, volume = DEFAULT_MATCH_AUDIO_VOLUME } =
    typeof options === 'boolean' ? { enabled: options } : options;

  const prevRef = useRef<MatchSnapshot | null>(null);
  const volumeRef = useRef(volume);

  useEffect(() => {
    const unlock = () => unlockMatchAudio(sharedCache);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    volumeRef.current = volume;
    for (const clip of sharedCache.values()) {
      clip.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (!enabled) {
      prevRef.current = snapshot;
      return;
    }

    const prev = prevRef.current;
    prevRef.current = snapshot;
    if (!prev) return;

    emitMatchAudioCues(prev, snapshot, volumeRef.current, sharedCache);
  }, [enabled, snapshot]);
}
