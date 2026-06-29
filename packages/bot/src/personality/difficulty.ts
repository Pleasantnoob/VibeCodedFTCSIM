import type { Difficulty } from '../types.js';

/** Unified turn rate for collect / park rotation. */
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

/** Faster snap when aligning intake toward the goal launch line. */
export function scoreTurnGainFor(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 5;
    case 'hard':
      return 6.5;
    default:
      return 6;
  }
}

/** Moderate turn easing near gate corners (drive speed unchanged). */
export function gateTurnGainFor(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 3.1;
    case 'hard':
      return 3.6;
    default:
      return 3.4;
  }
}

/** Gate creep uses the same turn easing as the caution zone. */
export function gateCreepTurnGainFor(difficulty: Difficulty): number {
  return gateTurnGainFor(difficulty);
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
