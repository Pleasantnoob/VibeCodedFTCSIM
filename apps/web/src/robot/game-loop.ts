export const PHYSICS_DT = 1 / 120;
export const MAX_PHYSICS_STEPS_PER_FRAME = 4;
export const HUD_UPDATE_INTERVAL_MS = 100;

export interface GameLoopAccumulator {
  lastTime: number;
  accumulator: number;
  lastHudTime: number;
}

export function createGameLoopAccumulator(now = performance.now()): GameLoopAccumulator {
  return { lastTime: now, accumulator: 0, lastHudTime: now };
}

export function advanceAccumulator(
  acc: GameLoopAccumulator,
  now: number,
  maxSteps = MAX_PHYSICS_STEPS_PER_FRAME,
): { steps: number; dt: number; frameDt: number } {
  const frameDt = Math.min((now - acc.lastTime) / 1000, 0.1);
  acc.lastTime = now;
  acc.accumulator += frameDt;
  const dt = PHYSICS_DT;
  let steps = 0;
  while (acc.accumulator >= dt && steps < maxSteps) {
    acc.accumulator -= dt;
    steps++;
  }
  return { steps, dt, frameDt };
}

export function shouldUpdateHud(acc: GameLoopAccumulator, now: number): boolean {
  if (now - acc.lastHudTime >= HUD_UPDATE_INTERVAL_MS) {
    acc.lastHudTime = now;
    return true;
  }
  return false;
}
