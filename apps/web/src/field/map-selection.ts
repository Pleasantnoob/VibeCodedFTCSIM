import type { SelectedBarrierVertex } from './barrier-editor';
import type { SelectedZoneVertex } from './zone-editor';

export type MapVertexSelection =
  | ({ layer: 'barrier' } & SelectedBarrierVertex)
  | ({ layer: 'zone' } & SelectedZoneVertex);

export function barrierSelection(id: string, vertexIndex: number): MapVertexSelection {
  return { layer: 'barrier', barrierId: id, vertexIndex };
}

export function zoneSelection(id: string, vertexIndex: number): MapVertexSelection {
  return { layer: 'zone', zoneId: id, vertexIndex };
}
