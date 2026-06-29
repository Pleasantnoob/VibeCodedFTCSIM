import type { Vector2 } from './types.js';
import { FIELD_SIZE_INCHES } from './coordinates.js';

export interface FieldViewport {
  /** Pixels per Pedro field inch (0–144). */
  scalePxPerInch: number;
  widthPx: number;
  heightPx: number;
}

export function createSquareFieldViewport(sizePx: number): FieldViewport {
  return {
    scalePxPerInch: sizePx / FIELD_SIZE_INCHES,
    widthPx: sizePx,
    heightPx: sizePx,
  };
}

/** Pedro inches (0–144, origin bottom-left) → field canvas pixels (origin top-left). */
export function pedroToFieldPx(point: Vector2, viewport: FieldViewport): Vector2 {
  return {
    x: point.x * viewport.scalePxPerInch,
    y: viewport.heightPx - point.y * viewport.scalePxPerInch,
  };
}

/** Field canvas pixels → Pedro inches. */
export function fieldPxToPedro(point: Vector2, viewport: FieldViewport): Vector2 {
  return {
    x: point.x / viewport.scalePxPerInch,
    y: (viewport.heightPx - point.y) / viewport.scalePxPerInch,
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
