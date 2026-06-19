export const DISPLAY_16_9 = { width: 1920, height: 1080 } as const;
export const HUD_DESIGN_WIDTH = 1920;

export function fitScale16x9(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(width / DISPLAY_16_9.width, height / DISPLAY_16_9.height);
}

export function scaled16x9Size(width: number, height: number): { scale: number; width: number; height: number } {
  const scale = fitScale16x9(width, height);
  return {
    scale,
    width: DISPLAY_16_9.width * scale,
    height: DISPLAY_16_9.height * scale,
  };
}

export function fitHudScale(width: number): number {
  if (width <= 0) return 1;
  return width / HUD_DESIGN_WIDTH;
}
