import type { Vector2 } from '@ftc-sim/field';

function cross2(a: Vector2, b: Vector2, c: Vector2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isEar(polygon: Vector2[], prev: number, current: number, next: number): boolean {
  const a = polygon[prev];
  const b = polygon[current];
  const c = polygon[next];
  if (cross2(a, b, c) <= 1e-8) return false;

  for (let i = 0; i < polygon.length; i++) {
    if (i === prev || i === current || i === next) continue;
    const point = polygon[i];
    if (pointInTriangle(point, a, b, c)) return false;
  }
  return true;
}

function pointInTriangle(point: Vector2, a: Vector2, b: Vector2, c: Vector2): boolean {
  const d1 = cross2(a, b, point);
  const d2 = cross2(b, c, point);
  const d3 = cross2(c, a, point);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Ear-clip triangulation for a simple polygon (physics meters). */
export function triangulatePolygon(vertices: Vector2[]): Uint32Array {
  if (vertices.length < 3) return new Uint32Array(0);

  const indices = vertices.map((_, index) => index);
  const triangles: number[] = [];
  let guard = 0;

  while (indices.length > 2 && guard < 10_000) {
    guard++;
    let clipped = false;

    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length];
      const current = indices[i];
      const next = indices[(i + 1) % indices.length];

      if (!isEar(vertices, prev, current, next)) continue;

      triangles.push(prev, current, next);
      indices.splice(i, 1);
      clipped = true;
      break;
    }

    if (!clipped) break;
  }

  return new Uint32Array(triangles);
}

export function polygonArea(vertices: Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Ensure counter-clockwise winding for Rapier triangulation. */
export function ensureCounterClockwise(vertices: Vector2[]): Vector2[] {
  if (polygonArea(vertices) < 0) return [...vertices].reverse();
  return vertices;
}
