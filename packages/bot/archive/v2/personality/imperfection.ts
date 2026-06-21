import type { Difficulty } from '../types.js';

const UTILITY_NOISE: Record<Difficulty, number> = {
  easy: 0.15,
  normal: 0.08,
  hard: 0.03,
};

const HESITATION_CHANCE: Record<Difficulty, number> = {
  easy: 0.08,
  normal: 0.03,
  hard: 0.01,
};

export function applyUtilityNoise(utility: number, difficulty: Difficulty): number {
  const span = UTILITY_NOISE[difficulty];
  return utility + (Math.random() - 0.5) * span * 2;
}

export function shouldHesitate(difficulty: Difficulty): boolean {
  return Math.random() < HESITATION_CHANCE[difficulty];
}

export function pickWrongTarget<T>(candidates: T[], difficulty: Difficulty): T {
  if (candidates.length <= 1 || !shouldHesitate(difficulty)) {
    return candidates[0]!;
  }
  const idx = 1 + Math.floor(Math.random() * Math.min(2, candidates.length - 1));
  return candidates[Math.min(idx, candidates.length - 1)]!;
}

export function applyAimImperfection(baseHeading: number, difficulty: Difficulty): number {
  const maxErr =
    difficulty === 'easy' ? (8 * Math.PI) / 180 : difficulty === 'normal' ? (4 * Math.PI) / 180 : (2 * Math.PI) / 180;
  return baseHeading + (Math.random() - 0.5) * maxErr;
}
