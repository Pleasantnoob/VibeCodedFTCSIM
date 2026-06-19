import type { Vector2 } from './types.js';
import { FIELD_SIZE_INCHES, VISUAL_FIELD_SIZE_INCHES, VISUAL_SCALE } from './coordinates.js';

export interface FieldViewport {
  /** Pixels per drawable field inch (141.5 in image space). */
  scalePxPerInch: number;
  widthPx: number;
  heightPx: number;
}

export function createSquareFieldViewport(sizePx: number): FieldViewport {
  return {
    scalePxPerInch: sizePx / VISUAL_FIELD_SIZE_INCHES,
    widthPx: sizePx,
    heightPx: sizePx,
  };
}

/** Pedro inches (0–144, origin bottom-left) → field canvas pixels (origin top-left). */
export function pedroToFieldPx(point: Vector2, viewport: FieldViewport): Vector2 {
  const visualX = point.x * VISUAL_SCALE;
  const visualY = point.y * VISUAL_SCALE;
  return {
    x: visualX * viewport.scalePxPerInch,
    y: viewport.heightPx - visualY * viewport.scalePxPerInch,
  };
}

/** Field canvas pixels → Pedro inches. */
export function fieldPxToPedro(point: Vector2, viewport: FieldViewport): Vector2 {
  const visualX = point.x / viewport.scalePxPerInch;
  const visualY = (viewport.heightPx - point.y) / viewport.scalePxPerInch;
  return {
    x: visualX / VISUAL_SCALE,
    y: visualY / VISUAL_SCALE,
  };
}

export function isPedroInBounds(point: Vector2, epsilon = 0.05): boolean {
  return (
    point.x >= -epsilon &&
    point.x <= FIELD_SIZE_INCHES + epsilon &&
    point.y >= -epsilon &&
    point.y <= FIELD_SIZE_INCHES + epsilon
  );
}
