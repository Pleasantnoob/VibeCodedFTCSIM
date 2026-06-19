import type { Vector2 } from '@ftc-sim/field';

/** Goal barrier polygon used by sim + match server (same shape as web editor). */
export interface SessionBarrier {
  id: string;
  label?: string;
  vertices: Vector2[];
}

export function barrierPolygons(barriers: SessionBarrier[]): Vector2[][] {
  return barriers.map((barrier) => barrier.vertices.map((v) => ({ x: v.x, y: v.y })));
}
