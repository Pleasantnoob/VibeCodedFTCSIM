import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ArtifactColor, FieldDefinition, FieldZoneDefinition, Pose, StagedArtifactLayout, Vector2 } from '@ftc-sim/field';
import type { SimArtifactState } from '@ftc-sim/mechanisms';
import { robotFootprintCorners, robotInGateZone } from '@ftc-sim/mechanisms';
import { BUNDLED_ARTIFACT_SPRITES } from '../artifact-sprites';
import {
  clampPedroPoint,
  createSquareFieldViewport,
  fieldPxToPedro,
  headingToVector,
  isPedroInBounds,
  pedroToFieldPx,
} from '@ftc-sim/field';
import { isPageVisible } from '../match/page-visible';
import type { EditableBarrier } from './barrier-editor';
import type { EditableZone } from './zone-editor';
import type { MapVertexSelection } from './map-selection';
import { barrierSelection, zoneSelection } from './map-selection';
import type { FieldRobotCatalogEntry, FieldRobotRenderState } from '../robot/match-robots';
import { PLAYER_ROBOT_ID } from '../robot/match-robots';
import { robotSkinById, type RobotSkinId } from '../robot/robot-skins';
import { smoothAlpha, smoothPose, shouldSnapPose } from '../net/smooth-motion';
import { extrapolateRobotSnapshot } from '../net/extrapolate';
import type { RobotSnapshotEntry } from '@ftc-sim/net';
import type { BotDebugState } from '@ftc-sim/bot';
import { gateCautionZones } from '@ftc-sim/bot';

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
  robotSkinId,
}: {
  entry: FieldRobotCatalogEntry;
  viewport: ReturnType<typeof createSquareFieldViewport>;
  robotSkinId: RobotSkinId;
}) {
  const scale = viewport.scalePxPerInch;
  const lengthPx = entry.length * scale;
  const widthPx = entry.width * scale;
  const labelSize = Math.max(10, Math.min(14, widthPx * 0.38));
  const skin = robotSkinById(robotSkinId);
  const clipId = `field-robot-clip-${entry.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  if (skin.imageUrl) {
    return (
      <>
        <defs>
          <clipPath id={clipId}>
            <rect x={-lengthPx / 2} y={-widthPx / 2} width={lengthPx} height={widthPx} rx={3} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <g transform="rotate(90)">
            <image
              className="field-robot__skin-image"
              href={skin.imageUrl}
              x={-widthPx / 2}
              y={-lengthPx / 2}
              width={widthPx}
              height={lengthPx}
              preserveAspectRatio="xMidYMid slice"
            />
          </g>
        </g>
        <rect
          className="field-robot__skin-frame"
          x={-lengthPx / 2}
          y={-widthPx / 2}
          width={lengthPx}
          height={widthPx}
          rx={3}
        />
        <text className="field-robot__team field-robot__team--skin" fontSize={labelSize} x={0} y={0} transform="rotate(90)">
          {formatTeamLabel(entry.teamNumber)}
        </text>
      </>
    );
  }

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
  plannedPathAlliance?: 'blue' | 'red';
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
  /** Interpolate robot motion between net snapshots (30 Hz). Artifacts stay snap-synced. */
  smoothNetMotion?: boolean;
  /** Server snapshot tick — when it drops, interpolation caches are cleared (RESET). */
  netSnapshotTick?: number;
  netRobotMotionRef?: RefObject<RobotSnapshotEntry[]>;
  netSnapshotAtRef?: RefObject<number>;
  /** Client-side prediction pose for the locally driven robot. */
  ownedRobotId?: string | null;
  ownedPoseRef?: RefObject<Pose | null>;
  showBotDebug?: boolean;
  botDebugRef?: RefObject<BotDebugState[] | null>;
  botAutoPathPreviewRef?: RefObject<BotDebugState[] | null>;
  robotSkinId?: RobotSkinId;
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

function botPathSignature(entry: BotDebugState, viewportWidthPx: number): string {
  const points = entry.path.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join('|');
  return `${viewportWidthPx}:${entry.task}:${points}`;
}

function botTargetSignature(entry: BotDebugState): string {
  const target = entry.target ? `${Math.round(entry.target.x)},${Math.round(entry.target.y)}` : '-';
  return `${entry.task}|${entry.artifactId ?? ''}:${target}`;
}

function botLabelLines(entry: BotDebugState): string[] {
  if (entry.aiVersion === 'collect') {
    if (entry.task === 'park') {
      return [`PARK · stored ${entry.storedCount}`, entry.atGoal ? 'in base' : 'driving'];
    }
    if (entry.task === 'gate') {
      return [`GATE · ramp full`, entry.atGoal ? 'tap done' : '→ gate'];
    }
    if (entry.task === 'score') {
      const lines = [
        `SCORE · stored ${entry.storedCount}`,
        entry.inLaunchZone
          ? entry.aligned
            ? 'shooting'
            : 'align goal'
          : `→ launch · ${entry.nav?.distTask.toFixed(0) ?? '?'}in`,
      ];
      if (entry.nav?.flags.length) {
        lines.push(`⚠ ${entry.nav.flags.join(', ')}`);
      }
      return lines;
    }
    const lines = [
      `COLLECT · stored ${entry.storedCount}/3`,
      entry.artifactId
        ? `→ ${entry.artifactId} · ${entry.nav?.distTask.toFixed(0) ?? '?'}in`
        : 'no target',
    ];
    if (entry.nav?.flags.length) {
      lines.push(`⚠ ${entry.nav.flags.join(', ')}`);
    }
    return lines;
  }
  const version = entry.aiVersion ?? 'v1';
  const drive = entry.driveFrame ?? 'robot';
  const nav = entry.nav;
  const lines = [
    `${version.toUpperCase()} · ${entry.task.toUpperCase()} · stored ${entry.storedCount}`,
    `drive ${drive} · replans ${entry.replanCount ?? 0} · wp ${nav?.waypointIndex ?? 0}/${nav?.pathLength ?? entry.pathLength}`,
  ];
  if (entry.autoPhase) {
    lines.push(
      `AUTO ${entry.autoPhase} step ${entry.autoStep ?? '?'}/${entry.autoStepCount ?? '?'} · segEnd ${entry.autoSegmentEndDist?.toFixed(0) ?? '?'}`,
    );
  }
  if (nav) {
    lines.push(
      `dist task ${nav.distTask.toFixed(0)} · goal ${nav.distGoal.toFixed(0)} · pursuit ${nav.distPursuit.toFixed(0)}`,
    );
    lines.push(
      `graph ${nav.startNode}→${nav.goalNode} · src ${nav.driveSource}`,
    );
    if (nav.flags.length > 0) {
      lines.push(`⚠ ${nav.flags.join(', ')}`);
    } else {
      lines.push(
        `launch ${entry.inLaunchZone ? 1 : 0} · aligned ${entry.aligned ? 1 : 0} · stuck ${entry.stuckPhase}`,
      );
    }
  } else {
    lines.push(
      `launch ${entry.inLaunchZone ? 1 : 0} · aligned ${entry.aligned ? 1 : 0} · stuck ${entry.stuckPhase}`,
    );
  }
  return lines;
}

function botPursuitSignature(entry: BotDebugState): string {
  const p = entry.nav?.pursuitTarget;
  return p ? `${Math.round(p.x)},${Math.round(p.y)}|${entry.nav?.waypointIndex ?? 0}` : '-';
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
  plannedPathAlliance = 'blue',
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
  netRobotMotionRef,
  netSnapshotAtRef,
  ownedRobotId = null,
  ownedPoseRef,
  showBotDebug = false,
  botDebugRef,
  botAutoPathPreviewRef,
  robotSkinId = 'transparent',
}: FieldCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MapVertexSelection | null>(null);
  const robotElsRef = useRef<Map<string, SVGGElement>>(new Map());
  const botDebugPathsLayerRef = useRef<SVGGElement>(null);
  const botDebugLabelsLayerRef = useRef<SVGGElement>(null);
  const botCollectScanLayerRef = useRef<SVGGElement>(null);
  const botCollectScanElsRef = useRef<Map<string, SVGRectElement>>(new Map());
  const botDebugElsRef = useRef<
    Map<
      string,
      {
        path: SVGPolylineElement;
        target: SVGCircleElement;
        pursuitLine: SVGLineElement;
        pursuit: SVGCircleElement;
        waypoint: SVGRectElement;
        labelBg: SVGRectElement;
        label: SVGTextElement;
      }
    >
  >(new Map());
  const botPathSignatureRef = useRef<Map<string, string>>(new Map());
  const botTargetSignatureRef = useRef<Map<string, string>>(new Map());
  const botPursuitSignatureRef = useRef<Map<string, string>>(new Map());
  const botLabelTextRef = useRef<Map<string, string>>(new Map());
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
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (!isPageVisible()) {
        idleTimer = setTimeout(tick, 250);
        return;
      }
      const now = performance.now();
      const alpha = smoothNetMotion
        ? smoothAlpha(Math.min(0.05, (now - robotMotionLastRef.current) / 1000), 22)
        : 1;
      robotMotionLastRef.current = now;

      const robots = fieldRobotsRef.current ?? [];
      for (const robotEntry of robots) {
        let robot = robotEntry;
        const g = robotElsRef.current.get(robot.id);
        if (!g) continue;

        if (ownedRobotId && robot.id === ownedRobotId && ownedPoseRef?.current) {
          robot = { ...robot, pose: ownedPoseRef.current };
        } else if (smoothNetMotion && netRobotMotionRef?.current) {
          const motion = netRobotMotionRef.current.find((entry) => entry.id === robot.id);
          const snapshotAt = netSnapshotAtRef?.current ?? now;
          if (motion) {
            robot = {
              ...robot,
              pose: extrapolateRobotSnapshot(motion, (now - snapshotAt) / 1000),
            };
          }
        }

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
    return () => {
      cancelAnimationFrame(frame);
      if (idleTimer !== null) clearTimeout(idleTimer);
    };
  }, [fieldRobotsRef, fieldRobotCatalog, playerCatalog, viewport, gateZones, showGateDetector, smoothNetMotion, ownedRobotId, ownedPoseRef]);

  useEffect(() => {
    if (!showBotDebug || !fieldRobotsRef) return;
    if (!botDebugRef && !botAutoPathPreviewRef) return;
    const pathsLayer = botDebugPathsLayerRef.current;
    const labelsLayer = botDebugLabelsLayerRef.current;
    if (!pathsLayer || !labelsLayer) return;

    let frame = 0;
    const tick = () => {
      const merged = new Map<string, BotDebugState>();
      for (const entry of botAutoPathPreviewRef?.current ?? []) {
        merged.set(entry.robotId, entry);
      }
      for (const entry of botDebugRef?.current ?? []) {
        merged.set(entry.robotId, entry);
      }
      const debugEntries = [...merged.values()];
      const robots = fieldRobotsRef.current ?? [];
      const seen = new Set<string>();

      for (const entry of debugEntries) {
        seen.add(entry.robotId);
        let els = botDebugElsRef.current.get(entry.robotId);
        if (!els) {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          path.classList.add('field-bot-debug-path');
          path.classList.add(`field-bot-debug-path--${entry.alliance}`);
          const target = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          target.classList.add('field-bot-debug-target');
          target.classList.add(`field-bot-debug-target--${entry.alliance}`);
          target.setAttribute('r', '5');
          const pursuitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          pursuitLine.classList.add('field-bot-debug-pursuit-line');
          const pursuit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          pursuit.classList.add('field-bot-debug-pursuit');
          pursuit.setAttribute('r', '4');
          const waypoint = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          waypoint.classList.add('field-bot-debug-waypoint');
          waypoint.setAttribute('width', '8');
          waypoint.setAttribute('height', '8');
          waypoint.setAttribute('x', '-4');
          waypoint.setAttribute('y', '-4');
          const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          labelBg.classList.add('field-bot-debug-label-bg');
          labelBg.classList.add(`field-bot-debug-label-bg--${entry.alliance}`);
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.classList.add('field-bot-debug-label');
          label.classList.add(`field-bot-debug-label--${entry.alliance}`);
          label.setAttribute('textAnchor', 'middle');
          pathsLayer.appendChild(path);
          pathsLayer.appendChild(pursuitLine);
          pathsLayer.appendChild(target);
          pathsLayer.appendChild(pursuit);
          pathsLayer.appendChild(waypoint);
          labelsLayer.appendChild(labelBg);
          labelsLayer.appendChild(label);
          els = { path, target, pursuitLine, pursuit, waypoint, labelBg, label };
          botDebugElsRef.current.set(entry.robotId, els);
        }

        const pathKey = botPathSignature(entry, viewport.widthPx);
        if (botPathSignatureRef.current.get(entry.robotId) !== pathKey) {
          botPathSignatureRef.current.set(entry.robotId, pathKey);
          if (entry.path.length >= 2) {
            els.path.setAttribute(
              'points',
              entry.path
                .map((pt) => {
                  const px = pedroToFieldPx(pt, viewport);
                  return `${px.x},${px.y}`;
                })
                .join(' '),
            );
            els.path.style.display = '';
          } else {
            els.path.style.display = 'none';
          }
        }

        if (entry.target) {
          const targetKey = botTargetSignature(entry);
          if (botTargetSignatureRef.current.get(entry.robotId) !== targetKey) {
            botTargetSignatureRef.current.set(entry.robotId, targetKey);
            const targetPx = pedroToFieldPx(entry.target, viewport);
            els.target.setAttribute('cx', String(targetPx.x));
            els.target.setAttribute('cy', String(targetPx.y));
          }
          els.target.style.display = '';
        } else {
          els.target.style.display = 'none';
        }

        const pursuitKey = botPursuitSignature(entry);
        const robot = robots.find((r) => r.id === entry.robotId);
        const robotPose =
          robot &&
          (smoothNetMotion
            ? (smoothedRobotPosesRef.current.get(robot.id) ?? robot.pose)
            : robot.pose);

        if (entry.nav?.pursuitTarget && robotPose) {
          if (botPursuitSignatureRef.current.get(entry.robotId) !== pursuitKey) {
            botPursuitSignatureRef.current.set(entry.robotId, pursuitKey);
            const pursuitPx = pedroToFieldPx(entry.nav.pursuitTarget, viewport);
            els.pursuit.setAttribute('cx', String(pursuitPx.x));
            els.pursuit.setAttribute('cy', String(pursuitPx.y));
          }
          const robotPx = pedroToFieldPx(robotPose, viewport);
          const pursuitPx = pedroToFieldPx(entry.nav.pursuitTarget, viewport);
          els.pursuitLine.setAttribute('x1', String(robotPx.x));
          els.pursuitLine.setAttribute('y1', String(robotPx.y));
          els.pursuitLine.setAttribute('x2', String(pursuitPx.x));
          els.pursuitLine.setAttribute('y2', String(pursuitPx.y));
          els.pursuit.style.display = '';
          els.pursuitLine.style.display = '';

          const wpIndex = entry.nav.waypointIndex;
          const wp = entry.path[wpIndex];
          if (wp) {
            const wpPx = pedroToFieldPx(wp, viewport);
            els.waypoint.setAttribute('transform', `translate(${wpPx.x} ${wpPx.y})`);
            els.waypoint.style.display = '';
          } else {
            els.waypoint.style.display = 'none';
          }
        } else {
          els.pursuit.style.display = 'none';
          els.pursuitLine.style.display = 'none';
          els.waypoint.style.display = 'none';
        }

        const catalogEntry = fieldRobotCatalog.find((r) => r.id === entry.robotId);
        const pose = robotPose;
        if (pose) {
          const center = pedroToFieldPx(pose, viewport);
          const robotHalfPx = catalogEntry
            ? (catalogEntry.length * viewport.scalePxPerInch) / 2
            : 14;
          const labelY = center.y - robotHalfPx - 34;
          const labelText = botLabelLines(entry).join('\n');
          if (botLabelTextRef.current.get(entry.robotId) !== labelText) {
            botLabelTextRef.current.set(entry.robotId, labelText);
            while (els.label.firstChild) els.label.removeChild(els.label.firstChild);
            botLabelLines(entry).forEach((line, index) => {
              const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
              tspan.setAttribute('x', String(center.x));
              tspan.setAttribute('dy', index === 0 ? '0' : '1.2em');
              tspan.textContent = line;
              els.label.appendChild(tspan);
            });
          } else {
            const tspans = els.label.querySelectorAll('tspan');
            tspans.forEach((tspan) => tspan.setAttribute('x', String(center.x)));
          }
          els.label.setAttribute('x', String(center.x));
          els.label.setAttribute('y', String(labelY));
          const bbox = els.label.getBBox();
          els.labelBg.setAttribute('x', String(bbox.x - 6));
          els.labelBg.setAttribute('y', String(bbox.y - 3));
          els.labelBg.setAttribute('width', String(bbox.width + 12));
          els.labelBg.setAttribute('height', String(bbox.height + 6));
          els.label.style.display = '';
          els.labelBg.style.display = '';
        } else {
          els.label.style.display = 'none';
          els.labelBg.style.display = 'none';
        }
      }

      for (const [id, els] of botDebugElsRef.current) {
        if (!seen.has(id)) {
          els.path.remove();
          els.pursuitLine.remove();
          els.target.remove();
          els.pursuit.remove();
          els.waypoint.remove();
          els.label.remove();
          els.labelBg.remove();
          botDebugElsRef.current.delete(id);
          botPathSignatureRef.current.delete(id);
          botTargetSignatureRef.current.delete(id);
          botPursuitSignatureRef.current.delete(id);
          botLabelTextRef.current.delete(id);
        }
      }

      const polledSeen = new Set<string>();
      const scanLayer = botCollectScanLayerRef.current;
      for (const entry of debugEntries) {
        if ((entry.task !== 'collect' && entry.task !== 'idle') || !entry.collectScan) continue;
        for (const polled of entry.collectScan.polled) {
          const key = `${entry.robotId}:${polled.id}`;
          polledSeen.add(key);
          let rect = botCollectScanElsRef.current.get(key);
          if (!rect && scanLayer) {
            rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.classList.add(
              polled.chosen ? 'field-bot-collect-chosen' : 'field-bot-collect-pass',
            );
            scanLayer.appendChild(rect);
            botCollectScanElsRef.current.set(key, rect);
          }
          if (!rect) continue;
          if (polled.chosen) {
            rect.classList.remove('field-bot-collect-pass');
            rect.classList.add('field-bot-collect-chosen');
          } else {
            rect.classList.remove('field-bot-collect-chosen');
            rect.classList.add('field-bot-collect-pass');
          }
          const center = pedroToFieldPx({ x: polled.x, y: polled.y }, viewport);
          const box = 5 * viewport.scalePxPerInch;
          rect.setAttribute('x', String(center.x - box / 2));
          rect.setAttribute('y', String(center.y - box / 2));
          rect.setAttribute('width', String(box));
          rect.setAttribute('height', String(box));
          rect.style.display = '';
        }
      }
      for (const [key, rect] of botCollectScanElsRef.current) {
        if (polledSeen.has(key)) continue;
        rect.remove();
        botCollectScanElsRef.current.delete(key);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const els of botDebugElsRef.current.values()) {
        els.path.remove();
        els.pursuitLine.remove();
        els.target.remove();
        els.pursuit.remove();
        els.waypoint.remove();
        els.label.remove();
        els.labelBg.remove();
      }
      botDebugElsRef.current.clear();
      for (const rect of botCollectScanElsRef.current.values()) {
        rect.remove();
      }
      botCollectScanElsRef.current.clear();
      botPathSignatureRef.current.clear();
      botPursuitSignatureRef.current.clear();
      botLabelTextRef.current.clear();
    };
  }, [showBotDebug, botDebugRef, botAutoPathPreviewRef, fieldRobotsRef, fieldRobotCatalog, viewport, smoothNetMotion]);

  useEffect(() => {
    if (!showArtifacts || !liveArtifactsRef) return;
    const layer = artifactLayerRef.current;
    if (!layer) return;

    const diameterPx = 5 * viewport.scalePxPerInch;
    const radiusPx = diameterPx / 2;
    const artifactDisplayRef = { current: new Map<string, Pose>() };

    let frame = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastNow = performance.now();
    const tick = (now: number) => {
      if (!isPageVisible()) {
        idleTimer = setTimeout(() => tick(performance.now()), 250);
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const alpha = smoothNetMotion ? smoothAlpha(dt, 28) : 1;
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

        const target = artifact.pose;
        const snapArtifact = artifact.phase === 'onRamp';
        const prev = artifactDisplayRef.current.get(artifact.id) ?? target;
        const display =
          snapArtifact || alpha >= 0.99 ? target : smoothPose(prev, target, alpha);
        artifactDisplayRef.current.set(artifact.id, display);

        const px = pedroToFieldPx(display, viewport);
        img.style.left = `${px.x - radiusPx}px`;
        img.style.top = `${px.y - radiusPx}px`;
        img.style.opacity = String(artifact.opacity);
      }

      for (const [id, img] of artifactElsRef.current) {
        if (!seen.has(id)) {
          img.remove();
          artifactElsRef.current.delete(id);
          artifactDisplayRef.current.delete(id);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (idleTimer !== null) clearTimeout(idleTimer);
      for (const img of artifactElsRef.current.values()) {
        img.remove();
      }
      artifactElsRef.current.clear();
    };
  }, [liveArtifactsRef, showArtifacts, viewport, smoothNetMotion]);

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
            {(liveArtifacts.length > 0
              ? liveArtifacts
              : artifactSpawns.filter((a) => !a.source.endsWith('_human_player_reserve'))
            ).map((artifact) => {
              const px = pedroToFieldPx(artifact.pose, viewport);
              const diameterPx = 5 * viewport.scalePxPerInch;
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
              className={`field-planned-path field-planned-path--${plannedPathAlliance}`}
              points={plannedPath
                .map((pt) => {
                  const px = pedroToFieldPx(pt, viewport);
                  return `${px.x},${px.y}`;
                })
                .join(' ')}
            />
          )}

          {showBotDebug &&
            gateCautionZones().map((zone) => {
              const scale = viewport.scalePxPerInch;
              const [wallA, wallB] = zone.wallSegment;
              const wallAPx = pedroToFieldPx(wallA, viewport);
              const wallBPx = pedroToFieldPx(wallB, viewport);
              const center = pedroToFieldPx(zone.anchor, viewport);
              return (
                <g
                  key={`gate-caution-${zone.alliance}`}
                  className={`field-gate-caution field-gate-caution--${zone.alliance}`}
                  aria-hidden
                >
                  <line
                    className="field-gate-caution-wall"
                    x1={wallAPx.x}
                    y1={wallAPx.y}
                    x2={wallBPx.x}
                    y2={wallBPx.y}
                  />
                  <circle
                    className="field-gate-caution-outer"
                    cx={center.x}
                    cy={center.y}
                    r={zone.outerIn * scale}
                  />
                  <circle
                    className="field-gate-caution-inner"
                    cx={center.x}
                    cy={center.y}
                    r={zone.innerIn * scale}
                  />
                  <circle className="field-gate-caution-anchor" cx={center.x} cy={center.y} r={3} />
                  <text
                    className="field-gate-caution-label"
                    x={center.x}
                    y={center.y - zone.outerIn * scale - 6}
                    textAnchor="middle"
                  >
                    {zone.anchor.label} ({zone.innerIn}/{zone.outerIn}″)
                  </text>
                </g>
              );
            })}

          <g ref={botCollectScanLayerRef} className="field-bot-debug-layer field-bot-debug-layer--collect-pass" aria-hidden />
          <g ref={botDebugPathsLayerRef} className="field-bot-debug-layer field-bot-debug-layer--paths" aria-hidden />

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
              <FieldRobotShape entry={entry} viewport={viewport} robotSkinId={robotSkinId} />
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

          <g ref={botDebugLabelsLayerRef} className="field-bot-debug-layer field-bot-debug-layer--labels" aria-hidden />
        </svg>
      </div>
    </div>
  );
}
