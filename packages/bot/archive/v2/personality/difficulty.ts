import type { Difficulty } from '../types.js';

export interface DifficultyProfile {
  reactionDelayMinMs: number;
  reactionDelayMaxMs: number;
  aimErrorRad: number;
  replanHesitationChance: number;
  inputSmoothingTau: number;
  utilityNoise: number;
  defendEnabled: boolean;
  contestEnabled: boolean;
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    reactionDelayMinMs: 350,
    reactionDelayMaxMs: 550,
    aimErrorRad: (8 * Math.PI) / 180,
    replanHesitationChance: 0.25,
    inputSmoothingTau: 0.12,
    utilityNoise: 0.15,
    defendEnabled: false,
    contestEnabled: false,
  },
  normal: {
    reactionDelayMinMs: 200,
    reactionDelayMaxMs: 400,
    aimErrorRad: (4 * Math.PI) / 180,
    replanHesitationChance: 0.1,
    inputSmoothingTau: 0.08,
    utilityNoise: 0.08,
    defendEnabled: false,
    contestEnabled: false,
  },
  hard: {
    reactionDelayMinMs: 120,
    reactionDelayMaxMs: 250,
    aimErrorRad: (2 * Math.PI) / 180,
    replanHesitationChance: 0.03,
    inputSmoothingTau: 0.05,
    utilityNoise: 0.03,
    defendEnabled: true,
    contestEnabled: true,
  },
};

export function profileForDifficulty(difficulty: Difficulty): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty];
}
