import type { FieldBodyDefinition, FieldDefinition, Vector2 } from '@ftc-sim/field';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';

export interface EditableBarrier {
  id: string;
  label: string;
  vertices: Vector2[];
}

export interface SelectedBarrierVertex {
  barrierId: string;
  vertexIndex: number;
}

export function initEditableBarriers(field: FieldDefinition): EditableBarrier[] {
  return getBarrierBodies(field).map((body) => ({
    id: body.id,
    label: body.label ?? body.id,
    vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
  }));
}

export function moveBarrierVertex(
  barriers: EditableBarrier[],
  barrierId: string,
  vertexIndex: number,
  point: Vector2,
): EditableBarrier[] {
  return barriers.map((barrier) => {
    if (barrier.id !== barrierId) return barrier;
    const vertices = barrier.vertices.map((v, i) =>
      i === vertexIndex ? { x: point.x, y: point.y } : v,
    );
    return { ...barrier, vertices };
  });
}

export function deleteBarrierVertex(
  barriers: EditableBarrier[],
  barrierId: string,
  vertexIndex: number,
): EditableBarrier[] {
  return barriers
    .map((barrier) => {
      if (barrier.id !== barrierId) return barrier;
      if (barrier.vertices.length <= 3) return barrier;
      return {
        ...barrier,
        vertices: barrier.vertices.filter((_, i) => i !== vertexIndex),
      };
    })
    .filter((barrier) => barrier.vertices.length >= 3);
}

export function deleteBarrier(barriers: EditableBarrier[], barrierId: string): EditableBarrier[] {
  return barriers.filter((b) => b.id !== barrierId);
}

/** Merge edited barrier vertices back into a field definition copy. */
export function applyBarriersToField(
  field: FieldDefinition,
  barriers: EditableBarrier[],
): FieldDefinition {
  const byId = new Map(barriers.map((b) => [b.id, b]));
  const bodies = field.bodies.map((body) => {
    const edited = byId.get(body.id);
    if (!edited) return body;
    return polygonBodyFromVertices(body, edited.vertices);
  });
  return { ...field, bodies };
}

function polygonBodyFromVertices(body: FieldBodyDefinition, vertices: Vector2[]): FieldBodyDefinition {
  return {
    ...body,
    shape: 'polygon',
    vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
    center: undefined,
    width: undefined,
    height: undefined,
  };
}

export function barriersToExportJson(barriers: EditableBarrier[]): string {
  const payload = barriers.map((b) => ({
    id: b.id,
    label: b.label,
    shape: 'polygon' as const,
    vertices: b.vertices.map((v) => ({
      x: Number(v.x.toFixed(2)),
      y: Number(v.y.toFixed(2)),
    })),
  }));
  return JSON.stringify(payload, null, 2);
}

export function clampSelection(
  barriers: EditableBarrier[],
  selected: SelectedBarrierVertex | null,
): SelectedBarrierVertex | null {
  if (!selected) return null;
  const barrier = barriers.find((b) => b.id === selected.barrierId);
  if (!barrier || selected.vertexIndex < 0 || selected.vertexIndex >= barrier.vertices.length) {
    return null;
  }
  return selected;
}
