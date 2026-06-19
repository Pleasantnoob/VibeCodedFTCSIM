/** Wall-clock driven fixed timestep loop (setInterval drifts on Windows at 120 Hz). */
export function startFixedTickLoop(options: {
  hz: number;
  maxCatchUpSteps?: number;
  onTick: (dt: number) => void;
}): () => void {
  const dt = 1 / options.hz;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? 10;
  let carry = 0;
  let lastWall = performance.now();
  let handle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const pump = () => {
    if (stopped) return;

    const now = performance.now();
    carry += Math.min((now - lastWall) / 1000, 0.25);
    lastWall = now;

    let steps = 0;
    while (carry >= dt && steps < maxCatchUpSteps) {
      carry -= dt;
      steps += 1;
      options.onTick(dt);
    }

    const nextDelay = carry >= dt ? 0 : Math.max(0, (dt - carry) * 1000);
    handle = setTimeout(pump, nextDelay);
  };

  handle = setTimeout(pump, 0);

  return () => {
    stopped = true;
    if (handle !== null) clearTimeout(handle);
  };
}
