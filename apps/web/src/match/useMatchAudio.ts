import { useEffect, useRef } from 'react';
import type { MatchSnapshot } from '@ftc-sim/match';

/** FTC Live v7.5.0 match sounds (install FTC Live once to populate public/ftc-live/audio). */
export const MATCH_AUDIO = {
  countdown: '/ftc-live/audio/3-2-1.wav',
  endAutoWarning: '/ftc-live/audio/endauto_with_warning.wav',
  endMatch: '/ftc-live/audio/endmatch.wav',
  charge: '/ftc-live/audio/charge.wav',
  firebell: '/ftc-live/audio/firebell.wav',
  whistle: '/ftc-live/audio/factwhistle.wav',
} as const;

export type MatchAudioCue = keyof typeof MATCH_AUDIO;

export const DEFAULT_MATCH_AUDIO_VOLUME = 0.5;

export interface MatchAudioOptions {
  enabled?: boolean;
  volume?: number;
}

function crossedBelow(prev: number, next: number, threshold: number): boolean {
  return prev > threshold && next <= threshold;
}

/** Returns sound cues that should fire between two consecutive match snapshots. */
export function matchAudioCues(prev: MatchSnapshot | null, next: MatchSnapshot): MatchAudioCue[] {
  if (!prev) return [];

  const cues: MatchAudioCue[] = [];
  const timed = !next.infiniteMode;

  if (prev.phase !== 'auto' && next.phase === 'auto') {
    cues.push('charge');
  }

  if (prev.phase === 'auto' && next.phase === 'transition') {
    cues.push('endAutoWarning');
  }

  if (
    timed &&
    next.phase === 'transition' &&
    crossedBelow(prev.timeRemainingInPhase, next.timeRemainingInPhase, 3)
  ) {
    cues.push('countdown');
  }

  if (timed && prev.phase !== 'teleop' && next.phase === 'teleop') {
    cues.push('firebell');
  }

  if (
    timed &&
    next.phase === 'teleop' &&
    crossedBelow(prev.timeRemainingInPhase, next.timeRemainingInPhase, 20)
  ) {
    cues.push('whistle');
  }

  if (prev.phase === 'teleop' && next.phase === 'post') {
    cues.push('endMatch');
  }

  return cues;
}

function playClip(
  cue: MatchAudioCue,
  cache: Map<MatchAudioCue, HTMLAudioElement>,
  volume: number,
): void {
  const src = MATCH_AUDIO[cue];
  let clip = cache.get(cue);
  if (!clip) {
    clip = new Audio(src);
    clip.preload = 'auto';
    cache.set(cue, clip);
  }
  clip.volume = volume;
  clip.currentTime = 0;
  void clip.play().catch(() => {
    /* Missing files until FTC Live assets are copied into public/ftc-live/audio */
  });
}

export function useMatchAudio(
  snapshot: MatchSnapshot,
  options: MatchAudioOptions | boolean = true,
): void {
  const { enabled = true, volume = DEFAULT_MATCH_AUDIO_VOLUME } =
    typeof options === 'boolean' ? { enabled: options } : options;

  const prevRef = useRef<MatchSnapshot | null>(null);
  const cacheRef = useRef(new Map<MatchAudioCue, HTMLAudioElement>());
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
    for (const clip of cacheRef.current.values()) {
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

    for (const cue of matchAudioCues(prev, snapshot)) {
      playClip(cue, cacheRef.current, volumeRef.current);
    }
  }, [enabled, snapshot]);
}
