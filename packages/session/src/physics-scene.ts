import type { FieldBodyDefinition } from '@ftc-sim/field';
import type { SessionBarrier } from './barriers.js';

export const ROBOT_BODY_ID = 'robot';

export function barrierToBodyDef(barrier: SessionBarrier): FieldBodyDefinition {
  return {
    id: barrier.id,
    type: 'static',
    shape: 'polygon',
    vertices: barrier.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    material: { friction: 0.6, restitution: 0 },
    label: barrier.label ?? barrier.id,
  };
}
