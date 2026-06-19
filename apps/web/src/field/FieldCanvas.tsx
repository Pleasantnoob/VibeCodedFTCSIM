import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ArtifactColor, FieldDefinition, FieldZoneDefinition, Pose, StagedArtifactLayout, Vector2 } from '@ftc-sim/field';
import type { SimArtifactState } from '@ftc-sim/mechanisms';
import { robotFootprintCorners, robotInGateZone } from '@ftc-sim/mechanisms';
import { BUNDLED_ARTIFACT_SPRITES } from '../artifact-sprites';
import {
  VISUAL_SCALE,
  clampPedroPoint,
  createSquareFieldViewport,
  fieldPxToPedro,
  headingToVector,
  isPedroInBounds,
  pedroToFieldPx,
} from '@ftc-sim/field';
import type { EditableBarrier } from './barrier-editor';
import type { EditableZone } from './zone-editor';
import type { MapVertexSelection } from './map-selection';
import { barrierSelection, zoneSelection } from './map-selection';
import type { FieldRobotCatalogEntry, FieldRobotRenderState } from '../robot/match-robots';
import { PLAYER_ROBOT_ID } from '../robot/match-robots';
import { smoothAlpha, smoothPose, shouldSnapPose } from '../net/smooth-motion';

export type { FieldRobotCatalogEntry, FieldRobotRenderState } from '../robot/match-robots';
export { PLAYER_ROBOT_ID } from '../robot/match-robots';

export interface RobotRenderProps {
  pose: Pose;
  alliance: 'blue' | 'red';
  width: number;
  length: number;
  teamNumber?: string;
}

function formatTeamLabel(teamNumber: string): string {
  return teamNumber.replace(/^-/, '');
}

function FieldRobotShape({
  entry,
  viewport,
}: {
  entry: FieldRobotCatalogEntry;
  viewport: ReturnType<typeof createSquareFieldViewport>;
}) {
  const scale = viewport.scalePxPerInch * VISUAL_SCALE;
  const lengthPx = entry.length * scale;
  const widthPx = entry.width * scale;
  const labelSize = Math.max(10, Math.min(14, widthPx * 0.38));
  return (
    <>
      <rect
        className="field-robot__body"
        x={-lengthPx / 2}
        y={-widthPx / 2}
        width={lengthPx}
        height={widthPx}
        rx={3}
      />
      <polygon
        className="field-robot__nose"
        points={`${lengthPx / 2},0 ${lengthPx / 2 - 8},-6 ${lengthPx / 2 - 8},6`}
      />
      <text className="field-robot__team" fontSize={labelSize} x={0} y={0} transform="rotate(90)">
        {formatTeamLabel(entry.teamNumber)}
      </text>
    </>
  );
}

export interface FieldCanvasProps {
  field: FieldDefinition;
  barriers: EditableBarrier[];
  zones: EditableZone[];
  showZones?: boolean;
  showBarriers?: boolean;
  showGrid?: boolean;
  editBarriers?: boolean;
  editZones?: boolean;
  selectedVertex?: MapVertexSelection | null;
  onHover?: (point: Vector2 | null) => void;
  onSelectVertex?: (selection: MapVertexSelection | null) => void;
  onMoveBarrierVertex?: (barrierId: string, vertexIndex: number, point: Vector2) => void;
  onMoveZoneVertex?: (zoneId: string, vertexIndex: number, point: Vector2) => void;
  fieldRobotsRef?: RefObject<FieldRobotRenderState[] | null>;
  fieldRobotCatalog?: FieldRobotCatalogEntry[];
  plannedPath?: Vector2[];
  showPlannedPath?: boolean;
  followerTarget?: Pose | null;
  showFollowerOverlay?: boolean;
  debugZones?: FieldZoneDefinition[];
  showDebugZones?: boolean;
  showGateDetector?: boolean;
  artifactSpawns?: StagedArtifactLayout[];
  liveArtifacts?: SimArtifactState[];
  liveArtifactsRef?: RefObject<SimArtifactState[] | null>;
  showArtifacts?: boolean;
  showCenterLine?: boolean;
  /** Interpolate robot motion between net snapshots (40 Hz). Artifacts stay snap-synced. */
  smoothNetMotion?: boolean;
  /** Server snapshot tick — when it drops, interpolation caches are cleared (RESET). */
  netSnapshotTick?: number;
}

const TILE_SIZE = 24;
const HANDLE_RADIUS = 6;

function pointsAttr(vertices: Vector2[], viewport: ReturnType<typeof createSquareFieldViewport>): string {
  return vertices
    .map((v) => {
      const p = pedroToFieldPx(v, viewport);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

function polygonCentroid(vertices: Vector2[]): Vector2 {
  const sum = vertices.reduce(
    (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / vertices.length, y: sum.y / vertices.length };
}

function eventToPedro(
  e: React.PointerEvent<SVGElement>,
  viewport: ReturnType<typeof createSquareFieldViewport>,
): Vector2 | null {
  const svg = e.currentTarget.ownerSVGElement ?? e.currentTarget;
  const rect = svg.getBoundingClientRect();
  const local = {
    x: ((e.clientX - rect.left) / rect.width) * viewport.widthPx,
    y: ((e.clientY - rect.top) / rect.height) * viewport.heightPx,
  };
  const pedro = clampPedroPoint(fieldPxToPedro(local, viewport));
  return isPedroInBounds(pedro) ? pedro : null;
}

function debugZoneClassName(zone: FieldZoneDefinition): string {
  const parts = ['field-zone', 'field-debug-zone'];
  if (zone.alliance) parts.push(`field-zone--${zone.alliance}`);
  if (zone.type === 'goal_basin') parts.push('field-zone--basin');
  if (zone.type === 'ramp') parts.push('field-zone--ramp');
  if (zone.type === 'gate_zone') parts.push('field-zone--gate');
  if (zone.type === 'base_zone') parts.push('field-zone--base');
  return parts.join(' ');
}

function artifactSprite(color: ArtifactColor): string {
  return BUNDLED_ARTIFACT_SPRITES[color];
}

export function FieldCanvas({
  field,
  barriers,
  zones,
  showZones = false,
  showBarriers = true,
  showGrid = true,
  editBarriers = false,
  editZones = false,
  selectedVertex = null,
  onHover,
  onSelectVertex,
  onMoveBarrierVertex,
  onMoveZoneVertex,
  fieldRobotsRef,
  fieldRobotCatalog = [],
  plannedPath = [],
  showPlannedPath = false,
  followerTarget = null,
  showFollowerOverlay = false,
  debugZones = [],
  showDebugZones = false,
  showGateDetector = false,
  artifactSpawns = [],
  liveArtifacts = [],
  liveArtifactsRef,
  showArtifacts = false,
  showCenterLine = false,
  smoothNetMotion = false,
  netSnapshotTick = 0,
}: FieldCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MapVertexSelection | null>(null);
  const robotElsRef = useRef<Map<string, SVGGElement>>(new Map());
  const smoothedRobotPosesRef = useRef<Map<string, Pose>>(new Map());
  const robotMotionLastRef = useRef(performance.now());
  const lastNetSnapshotTickRef = useRef(netSnapshotTick);

  useEffect(() => {
    if (netSnapshotTick < lastNetSnapshotTickRef.current) {
      smoothedRobotPosesRef.current.clear();
    }
    lastNetSnapshotTickRef.current = netSnapshotTick;
  }, [netSnapshotTick]);
  const artifactLayerRef = useRef<HTMLDivElement>(null);
  const artifactElsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const gateFootprintRef = useRef<SVGPolygonElement>(null);
  const gateZoneElsRef = useRef<Map<string, SVGPolygonElement>>(new Map());
  const [size, setSize] = useState(400);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const next = Math.max(120, Math.min(host.clientWidth, host.clientHeight) - 16);
      setSize(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const viewport = useMemo(() => createSquareFieldViewport(size), [size]);
  const imagePath = field.visualAssets?.fieldImage ?? '/assets/decode.webp';
  const gateZones = useMemo(
    () => field.zones.filter((zone) => zone.type === 'gate_zone'),
    [field.zones],
  );

  const playerCatalog = useMemo(
    () => fieldRobotCatalog.find((entry) => entry.id === PLAYER_ROBOT_ID) ?? null,
    [fieldRobotCatalog],
  );

  useEffect(() => {
    if (!fieldRobotsRef || fieldRobotCatalog.length === 0) return;

    const footprintEl = gateFootprintRef.current;
    const playerFootprint = playerCatalog
      ? { width: playerCatalog.width, length: playerCatalog.length }
      : null;

    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const alpha = smoothNetMotion
        ? smoothAlpha(Math.min(0.05, (now - robotMotionLastRef.current) / 1000), 22)
        : 1;
      robotMotionLastRef.current = now;

      const robots = fieldRobotsRef.current ?? [];
      for (const robot of robots) {
        const g = robotElsRef.current.get(robot.id);
        if (!g) continue;

        let pose = robot.pose;
        if (smoothNetMotion) {
          const prev = smoothedRobotPosesRef.current.get(robot.id) ?? robot.pose;
          pose = shouldSnapPose(prev, robot.pose) ? robot.pose : smoothPose(prev, robot.pose, alpha);
          smoothedRobotPosesRef.current.set(robot.id, pose);
        }

        const center = pedroToFieldPx(pose, viewport);
        const headingDeg = -(pose.heading * 180) / Math.PI;
        g.setAttribute('transform', `translate(${center.x} ${center.y}) rotate(${headingDeg})`);
      }

      if (showGateDetector && footprintEl && playerFootprint) {
        const player = robots.find((entry) => entry.id === PLAYER_ROBOT_ID);
        if (player) {
          const playerPose = smoothNetMotion
            ? (smoothedRobotPosesRef.current.get(player.id) ?? player.pose)
            : player.pose;
          const corners = robotFootprintCorners(playerPose, playerFootprint);
          footprintEl.setAttribute('points', pointsAttr(corners, viewport));

          let overlapping = false;
          for (const zone of gateZones) {
            const inside = robotInGateZone(playerPose, playerFootprint, zone.polygon);
            overlapping ||= inside;
            const zoneEl = gateZoneElsRef.current.get(zone.id);
            zoneEl?.classList.toggle('field-gate-zone--active', inside);
          }
          footprintEl.classList.toggle('field-gate-footprint--active', overlapping);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fieldRobotsRef, fieldRobotCatalog, playerCatalog, viewport, gateZones, showGateDetector, smoothNetMotion]);

  useEffect(() => {
    if (!showArtifacts || !liveArtifactsRef) return;
    const layer = artifactLayerRef.current;
    if (!layer) return;

    const diameterPx = 5 * viewport.scalePxPerInch * VISUAL_SCALE;
    const radiusPx = diameterPx / 2;

    let frame = 0;
    const tick = () => {
      const artifacts = liveArtifactsRef.current ?? [];
      const seen = new Set<string>();

      for (const artifact of artifacts) {
        seen.add(artifact.id);
        let img = artifactElsRef.current.get(artifact.id);
        if (!img) {
          img = document.createElement('img');
          img.className = `field-artifact field-artifact--${artifact.color}`;
          img.src = artifactSprite(artifact.color);
          img.alt = '';
          img.draggable = false;
          img.style.position = 'absolute';
          img.style.width = `${diameterPx}px`;
          img.style.height = `${diameterPx}px`;
          img.style.pointerEvents = 'none';
          layer.appendChild(img);
          artifactElsRef.current.set(artifact.id, img);
        }

        const px = pedroToFieldPx(artifact.pose, viewport);
        img.style.left = `${px.x - radiusPx}px`;
        img.style.top = `${px.y - radiusPx}px`;
        img.style.opacity = String(artifact.opacity);
      }

      for (const [id, img] of artifactElsRef.current) {
        if (!seen.has(id)) {
          img.remove();
          artifactElsRef.current.delete(id);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const img of artifactElsRef.current.values()) {
        img.remove();
      }
      artifactElsRef.current.clear();
    };
  }, [liveArtifactsRef, showArtifacts, viewport]);

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      const pedro = eventToPedro(e, viewport);
      if (pedro) {
        if (dragRef.current.layer === 'barrier') {
          onMoveBarrierVertex?.(dragRef.current.barrierId, dragRef.current.vertexIndex, pedro);
        } else {
          onMoveZoneVertex?.(dragRef.current.zoneId, dragRef.current.vertexIndex, pedro);
        }
        onHover?.(pedro);
      }
      return;
    }

    const pedro = eventToPedro(e, viewport);
    onHover?.(pedro);
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const startVertexDrag = (e: React.PointerEvent<SVGCircleElement>, selection: MapVertexSelection) => {
    e.stopPropagation();
    dragRef.current = selection;
    onSelectVertex?.(selection);
    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
  };

  const isBarrierSelected = (barrierId: string) =>
    selectedVertex?.layer === 'barrier' && selectedVertex.barrierId === barrierId;

  const isZoneSelected = (zoneId: string) =>
    selectedVertex?.layer === 'zone' && selectedVertex.zoneId === zoneId;

  return (
    <div ref={hostRef} className="field-canvas-host">
      <div className="field-canvas-frame" style={{ width: size, height: size }}>
        <img src={imagePath} alt="DECODE field" className="field-canvas-image" draggable={false} />
        {showArtifacts && liveArtifactsRef && (
          <div ref={artifactLayerRef} className="field-artifact-layer" aria-hidden />
        )}
        {showArtifacts && !liveArtifactsRef && (
          <div className="field-artifact-layer" aria-hidden>
            {(liveArtifacts.length > 0 ? liveArtifacts : artifactSpawns).map((artifact) => {
              const px = pedroToFieldPx(artifact.pose, viewport);
              const diameterPx = 5 * viewport.scalePxPerInch * VISUAL_SCALE;
              const radiusPx = diameterPx / 2;
              const color = artifact.color;
              const opacity = 'opacity' in artifact ? artifact.opacity : 1;
              const src = artifactSprite(color);
              return (
                <img
                  key={artifact.id}
                  className={`field-artifact field-artifact--${color}`}
                  src={src}
                  alt=""
                  draggable={false}
                  style={{
                    left: px.x - radiusPx,
                    top: px.y - radiusPx,
                    width: diameterPx,
                    height: diameterPx,
                    opacity,
                  }}
                />
              );
            })}
          </div>
        )}
        <svg
          className="field-canvas-svg"
          viewBox={`0 0 ${viewport.widthPx} ${viewport.heightPx}`}
          onPointerMove={onSvgPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={(e) => {
            dragRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            onHover?.(null);
          }}
          onPointerCancel={endDrag}
        >
          {showGrid &&
            Array.from({ length: 7 }, (_, i) => {
              const inch = i * TILE_SIZE;
              const xLine = pedroToFieldPx({ x: inch, y: 0 }, viewport);
              const xTop = pedroToFieldPx({ x: inch, y: 144 }, viewport);
              const yLine = pedroToFieldPx({ x: 0, y: inch }, viewport);
              const yRight = pedroToFieldPx({ x: 144, y: inch }, viewport);
              return (
                <g key={i} className="field-grid">
                  <line x1={xLine.x} y1={xLine.y} x2={xTop.x} y2={xTop.y} />
                  <line x1={yLine.x} y1={yLine.y} x2={yRight.x} y2={yRight.y} />
                </g>
              );
            })}

          {showZones &&
            zones.map((zone) => {
              const centroid = pedroToFieldPx(polygonCentroid(zone.vertices), viewport);
              return (
                <g key={zone.id}>
                  <polygon
                    className={`field-zone field-zone--launch${isZoneSelected(zone.id) ? ' field-zone--selected' : ''}`}
                    points={pointsAttr(zone.vertices, viewport)}
                    onPointerDown={(e) => {
                      if (!editZones) return;
                      e.preventDefault();
                      onSelectVertex?.(zoneSelection(zone.id, 0));
                    }}
                  />
                  <text
                    className="field-zone-label"
                    x={centroid.x}
                    y={centroid.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {zone.label}
                  </text>
                  {editZones &&
                    zone.vertices.map((vertex, index) => {
                      const px = pedroToFieldPx(vertex, viewport);
                      const isSelected =
                        selectedVertex?.layer === 'zone' &&
                        selectedVertex.zoneId === zone.id &&
                        selectedVertex.vertexIndex === index;
                      return (
                        <circle
                          key={`${zone.id}-${index}`}
                          className={`field-handle field-handle--zone${isSelected ? ' field-handle--selected' : ''}`}
                          cx={px.x}
                          cy={px.y}
                          r={isSelected ? 8 : HANDLE_RADIUS}
                          onPointerDown={(e) => startVertexDrag(e, zoneSelection(zone.id, index))}
                        />
                      );
                    })}
                </g>
              );
            })}

          {showDebugZones &&
            debugZones.map((zone) => {
              const centroid = pedroToFieldPx(polygonCentroid(zone.polygon), viewport);
              return (
                <g key={zone.id}>
                  <polygon
                    className={debugZoneClassName(zone)}
                    points={pointsAttr(zone.polygon, viewport)}
                  />
                  <text
                    className="field-zone-label field-zone-label--debug"
                    x={centroid.x}
                    y={centroid.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {zone.label ?? zone.id}
                  </text>
                </g>
              );
            })}

          {showGateDetector &&
            gateZones.map((zone) => {
              const centroid = pedroToFieldPx(polygonCentroid(zone.polygon), viewport);
              return (
                <g key={`gate-${zone.id}`} className="field-gate-layer">
                  <polygon
                    ref={(el) => {
                      if (el) gateZoneElsRef.current.set(zone.id, el);
                      else gateZoneElsRef.current.delete(zone.id);
                    }}
                    className={`field-zone field-zone--gate field-gate-zone${zone.alliance ? ` field-zone--${zone.alliance}` : ''}`}
                    points={pointsAttr(zone.polygon, viewport)}
                  />
                  <text
                    className="field-zone-label field-zone-label--gate"
                    x={centroid.x}
                    y={centroid.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {zone.label ?? zone.id}
                  </text>
                </g>
              );
            })}

          {showGateDetector && (
            <g className="field-gate-footprint-layer" aria-hidden>
              <polygon ref={gateFootprintRef} className="field-gate-footprint" />
            </g>
          )}

          {showCenterLine &&
            (() => {
              const bottom = pedroToFieldPx({ x: 72, y: 0 }, viewport);
              const top = pedroToFieldPx({ x: 72, y: 144 }, viewport);
              return (
                <line
                  className="field-center-line"
                  x1={bottom.x}
                  y1={bottom.y}
                  x2={top.x}
                  y2={top.y}
                />
              );
            })()}

          {showBarriers &&
            barriers.map((barrier) => (
              <g key={barrier.id}>
                <polygon
                  className={`field-barrier field-barrier--${barrier.id}${isBarrierSelected(barrier.id) ? ' field-barrier--selected' : ''}`}
                  points={pointsAttr(barrier.vertices, viewport)}
                  onPointerDown={(e) => {
                    if (!editBarriers) return;
                    e.preventDefault();
                    onSelectVertex?.(barrierSelection(barrier.id, 0));
                  }}
                />
                {editBarriers &&
                  barrier.vertices.map((vertex, index) => {
                    const px = pedroToFieldPx(vertex, viewport);
                    const isSelected =
                      selectedVertex?.layer === 'barrier' &&
                      selectedVertex.barrierId === barrier.id &&
                      selectedVertex.vertexIndex === index;
                    return (
                      <circle
                        key={`${barrier.id}-${index}`}
                        className={`field-handle${isSelected ? ' field-handle--selected' : ''}`}
                        cx={px.x}
                        cy={px.y}
                        r={isSelected ? 8 : HANDLE_RADIUS}
                        onPointerDown={(e) => startVertexDrag(e, barrierSelection(barrier.id, index))}
                      />
                    );
                  })}
              </g>
            ))}

          {showPlannedPath && plannedPath.length >= 2 && (
            <polyline
              className="field-planned-path"
              points={plannedPath
                .map((pt) => {
                  const px = pedroToFieldPx(pt, viewport);
                  return `${px.x},${px.y}`;
                })
                .join(' ')}
            />
          )}

          {fieldRobotCatalog.map((entry) => (
            <g
              key={entry.id}
              ref={(el) => {
                if (el) robotElsRef.current.set(entry.id, el);
                else robotElsRef.current.delete(entry.id);
              }}
              className={`field-robot field-robot--${entry.alliance}${
                entry.id === PLAYER_ROBOT_ID ? ' field-robot--player' : ''
              }`}
            >
              <FieldRobotShape entry={entry} viewport={viewport} />
            </g>
          ))}

          {showFollowerOverlay && followerTarget && (() => {
            const player = fieldRobotsRef?.current?.find((entry) => entry.id === PLAYER_ROBOT_ID);
            const robotPose = player?.pose;
            if (!robotPose) return null;
            const robotPx = pedroToFieldPx(robotPose, viewport);
            const targetPx = pedroToFieldPx(followerTarget, viewport);
            const headingLen = 14;
            const targetHeading = headingToVector(followerTarget.heading);
            const headingEnd = {
              x: robotPx.x + targetHeading.x * headingLen,
              y: robotPx.y - targetHeading.y * headingLen,
            };
            return (
              <g className="field-follower-overlay">
                <line
                  className="field-follower-error"
                  x1={robotPx.x}
                  y1={robotPx.y}
                  x2={targetPx.x}
                  y2={targetPx.y}
                />
                <line
                  className="field-follower-heading"
                  x1={robotPx.x}
                  y1={robotPx.y}
                  x2={headingEnd.x}
                  y2={headingEnd.y}
                />
                <circle className="field-follower-target" cx={targetPx.x} cy={targetPx.y} r={4} />
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}
