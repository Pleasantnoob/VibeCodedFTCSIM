import type { Difficulty } from '../types.js';

/** Unified turn rate for all bot rotation (collect / score / park). */
export function turnGainFor(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 3.2;
    case 'hard':
      return 3.5;
    default:
      return 3.5;
  }
}

export function clusterWeightFor(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 12;
    case 'hard':
      return 22;
    default:
      return 18;
  }
}

export function usesVelocityDeconflict(difficulty: Difficulty): boolean {
  return difficulty === 'hard';
}
