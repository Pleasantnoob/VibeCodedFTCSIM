import type { FieldDefinition, Vector2 } from '@ftc-sim/field';
import { getLaunchZones } from '@ftc-sim/field';

export interface EditableZone {
  id: string;
  label: string;
  points: number;
  vertices: Vector2[];
}

export interface SelectedZoneVertex {
  zoneId: string;
  vertexIndex: number;
}

export function initEditableZones(field: FieldDefinition): EditableZone[] {
  return getLaunchZones(field).map((zone) => ({
    id: zone.id,
    label: zone.label ?? zone.id,
    points: zone.points ?? 3,
    vertices: zone.polygon.map((v) => ({ x: v.x, y: v.y })),
  }));
}

export function moveZoneVertex(
  zones: EditableZone[],
  zoneId: string,
  vertexIndex: number,
  point: Vector2,
): EditableZone[] {
  return zones.map((zone) => {
    if (zone.id !== zoneId) return zone;
    const vertices = zone.vertices.map((v, i) =>
      i === vertexIndex ? { x: point.x, y: point.y } : v,
    );
    return { ...zone, vertices };
  });
}

export function deleteZoneVertex(
  zones: EditableZone[],
  zoneId: string,
  vertexIndex: number,
): EditableZone[] {
  return zones
    .map((zone) => {
      if (zone.id !== zoneId) return zone;
      if (zone.vertices.length <= 3) return zone;
      return {
        ...zone,
        vertices: zone.vertices.filter((_, i) => i !== vertexIndex),
      };
    })
    .filter((zone) => zone.vertices.length >= 3);
}

export function clampZoneSelection(
  zones: EditableZone[],
  selected: SelectedZoneVertex | null,
): SelectedZoneVertex | null {
  if (!selected) return null;
  const zone = zones.find((z) => z.id === selected.zoneId);
  if (!zone || selected.vertexIndex < 0 || selected.vertexIndex >= zone.vertices.length) {
    return null;
  }
  return selected;
}

export function zonesToExportJson(zones: EditableZone[]): string {
  const payload = zones.map((z) => ({
    id: z.id,
    type: 'launch_zone',
    alliance: 'neutral',
    label: z.label,
    points: z.points,
    polygon: z.vertices.map((v) => ({
      x: Number(v.x.toFixed(2)),
      y: Number(v.y.toFixed(2)),
    })),
  }));
  return JSON.stringify(payload, null, 2);
}
