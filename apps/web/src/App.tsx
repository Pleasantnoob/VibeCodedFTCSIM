import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import { getDebugZones } from '@ftc-sim/field';
import type { AutoSequence, PathChain, PedroJsonFile } from '@ftc-sim/pedro';
import {
  AutoSequenceRunner,
  autoSequenceForAlliance,
  getPathStartPose,
  pathChainForAlliance,
  pathChainToPoints,
  parsePathFileText,
} from '@ftc-sim/pedro';
import type { Vector2 } from '@ftc-sim/field';
import type { SimArtifactState } from '@ftc-sim/mechanisms';
import { usePhysicsRobot } from './robot/usePhysicsRobot';
import { playerSpawnPose, practiceFieldRobots } from './robot/match-robots';
import { DEFAULT_ARTIFACT_FRICTION } from './artifacts/artifact-world';
import {
  DEFAULT_SIM_ROBOT_CONFIG,
  SIM_ROBOT_PRESETS,
  type SimRobotConfig,
} from './robot/robot-config';
import { FieldCanvas } from './field/FieldCanvas';
import { hasActiveDriveInput } from './input/drive-input-sampler';
import {
  barriersToExportJson,
  clampSelection as clampBarrierSelection,
  deleteBarrier,
  deleteBarrierVertex,
  initEditableBarriers,
  moveBarrierVertex,
} from './field/barrier-editor';
import type { MapVertexSelection } from './field/map-selection';
import { barrierSelection, zoneSelection } from './field/map-selection';
import {
  clampZoneSelection,
  deleteZoneVertex,
  initEditableZones,
  moveZoneVertex,
  zonesToExportJson,
} from './field/zone-editor';
import { useDriveInput } from './input/useDriveInput';
import { useMatchClock } from './match/useMatchClock';
import type { MatchSnapshot } from '@ftc-sim/match';
import { MatchFieldOverlay } from './match/MatchFieldOverlay';
import { MatchResultsCeremony } from './match/MatchResultsCeremony';
import { useMatchAudio } from './match/useMatchAudio';
import { PanelSection, PanelsButton, PanelsLogo } from './components/panels';
import { installFtcSimDevApi } from './dev/inject-drive';
import { getSessionModeFromUrl, type SessionMode } from './session/session-mode';
import { useSessionClient } from './session/useSessionClient';
import { LobbyScreen } from './session/LobbyScreen';
import './panels.css';

const PHASES = [
  { id: 0, name: 'Shell', status: 'done' as const },
  { id: 1, name: 'Field canvas', status: 'done' as const },
  { id: 2, name: 'Kinematic robot', status: 'done' as const },
  { id: 3, name: 'Physics core', status: 'done' as const },
  { id: 4, name: 'Match clock', status: 'done' as const },
  { id: 5, name: 'Pedro paths', status: 'done' as const },
  { id: 6, name: 'Path follower', status: 'done' as const },
  { id: 7, name: 'DECODE field data', status: 'done' as const },
  { id: 8, name: 'Mechanisms & scoring', status: 'active' as const },
  { id: 9, name: 'Telemetry & replay', status: 'upcoming' as const },
  { id: 10, name: 'QA & E2E', status: 'upcoming' as const },
];

type Alliance = 'blue' | 'red';

/** Placeholder until the first server snapshot arrives — never use solo clock in net mode. */
const NET_SETUP_SNAPSHOT: MatchSnapshot = {
  phase: 'setup',
  timeElapsed: 0,
  timeRemainingInPhase: 0,
  running: false,
  paused: false,
  allowsDrive: false,
  controlSource: 'none',
  infiniteMode: false,
};

const BUILTIN_PATHS = [
  { id: 'decode-pp', label: 'Decode Auto (PP export)', file: '/examples/decode-auto.pp' },
  { id: 'decode-json', label: 'Decode Auto (JSON curve)', file: '/examples/decode-auto.json' },
] as const;

type BuiltinPathId = (typeof BUILTIN_PATHS)[number]['id'];
type LoadedPathId = BuiltinPathId | 'upload' | null;

function clampMapSelection(
  barriers: ReturnType<typeof initEditableBarriers>,
  zones: ReturnType<typeof initEditableZones>,
  selected: MapVertexSelection | null,
): MapVertexSelection | null {
  if (!selected) return null;
  if (selected.layer === 'barrier') {
    const clamped = clampBarrierSelection(barriers, selected);
    return clamped ? { layer: 'barrier', ...clamped } : null;
  }
  const clamped = clampZoneSelection(zones, selected);
  return clamped ? { layer: 'zone', ...clamped } : null;
}

function overlayTeamsFromCatalog(
  catalog: Array<{ id: string; teamNumber: string }>,
  fallback: { red: [string, string]; blue: [string, string] },
): { red: [string, string]; blue: [string, string] } {
  const team = (id: string, defaultLabel: string) =>
    catalog.find((entry) => entry.id === id)?.teamNumber ?? defaultLabel;
  return {
    blue: [team('player', fallback.blue[0]), team('blue-near', fallback.blue[1])],
    red: [team('red-far', fallback.red[0]), team('red-near', fallback.red[1])],
  };
}

export function App() {
  const field = useMemo(() => getDecodeField(), []);
  useEffect(() => {
    document.getElementById('boot-msg')?.remove();
  }, []);

  const urlSession = useMemo(() => getSessionModeFromUrl(), []);
  const [sessionMode, setSessionMode] = useState<SessionMode>(urlSession.mode);
  const net = useSessionClient();
  const isNetActive = sessionMode !== 'solo' && net.connected;
  const isNetSession = sessionMode !== 'solo';
  const autoConnectDone = useRef(false);
  useEffect(() => {
    if (autoConnectDone.current) return;
    if (urlSession.mode !== 'host' && urlSession.mode !== 'join') return;
    autoConnectDone.current = true;
    setSessionMode(urlSession.mode);
    net.connect(
      urlSession.address ?? '127.0.0.1:5191',
      urlSession.displayName ?? 'Driver',
      urlSession.mode === 'join' ? 'join' : 'host',
    );
  }, [urlSession, net.connect]);
  const netArtifactsRef = useRef<SimArtifactState[]>([]);
  const fieldCenterRef = useRef<HTMLElement>(null);
  const [barriers, setBarriers] = useState(() => initEditableBarriers(field));
  const [zones, setZones] = useState(() => initEditableZones(field));
  const [editBarriers, setEditBarriers] = useState(false);
  const [editZones, setEditZones] = useState(false);
  const [selectedVertex, setSelectedVertex] = useState<MapVertexSelection | null>(null);
  const [alliance, setAlliance] = useState<Alliance>('blue');
  const [artifactFriction, setArtifactFriction] = useState(DEFAULT_ARTIFACT_FRICTION);
  const artifactFrictionRef = useRef(artifactFriction);
  artifactFrictionRef.current = artifactFriction;
  const [showZones, setShowZones] = useState(false);
  const [showBarriers, setShowBarriers] = useState(false);
  const [showDebugZones, setShowDebugZones] = useState(false);
  const [showGateDetector, setShowGateDetector] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(true);
  const [showMatchOverlay, setShowMatchOverlay] = useState(true);
  const [overlayEventName, setOverlayEventName] = useState('FTC Sim');
  const [overlayMatchName, setOverlayMatchName] = useState('Practice Match');
  const [overlayRedTeams, setOverlayRedTeams] = useState<[string, string]>(['-1', '-2']);
  const [overlayBlueTeams, setOverlayBlueTeams] = useState<[string, string]>(['-3', '-4']);
  const [matchSounds, setMatchSounds] = useState(true);
  const [matchSoundVolume, setMatchSoundVolume] = useState(0.5);
  const [ceremonyActive, setCeremonyActive] = useState(false);
  const [ceremonyTrigger, setCeremonyTrigger] = useState(0);
  const [showCenterLine, setShowCenterLine] = useState(false);
  const [hover, setHover] = useState<Vector2 | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [basePathChain, setBasePathChain] = useState<PathChain | null>(null);
  const [baseAutoSequence, setBaseAutoSequence] = useState<AutoSequence | null>(null);
  const pathChain = useMemo(
    () => (basePathChain ? pathChainForAlliance(basePathChain, alliance) : null),
    [basePathChain, alliance],
  );
  const autoSequence = useMemo(
    () => (baseAutoSequence ? autoSequenceForAlliance(baseAutoSequence, alliance) : null),
    [baseAutoSequence, alliance],
  );
  const [pathFormat, setPathFormat] = useState<string | null>(null);
  const [pathWarnings, setPathWarnings] = useState<string[]>([]);
  const [pathError, setPathError] = useState<string | null>(null);
  const [showPlannedPath, setShowPlannedPath] = useState(true);
  const [selectedPathId, setSelectedPathId] = useState<BuiltinPathId>('decode-pp');
  const [loadedPathId, setLoadedPathId] = useState<LoadedPathId>(null);
  const pathChainRef = useRef<PathChain | null>(null);
  pathChainRef.current = pathChain;
  const autoSequenceRef = useRef<AutoSequence | null>(null);
  autoSequenceRef.current = autoSequence;
  const followerRef = useRef(new AutoSequenceRunner());
  const resetRobotRef = useRef<(pose?: { x: number; y: number; heading: number }) => void>(() => {});
  const [robotConfig, setRobotConfig] = useState<SimRobotConfig>(DEFAULT_SIM_ROBOT_CONFIG);
  const robotConfigRef = useRef(robotConfig);
  robotConfigRef.current = robotConfig;
  const practiceRobots = useMemo(
    () =>
      sessionMode === 'solo'
        ? []
        : practiceFieldRobots(
            {
              width: robotConfig.footprintWidth,
              length: robotConfig.footprintLength,
            },
            {
              blueNear: overlayBlueTeams[0],
              blueFar: overlayBlueTeams[1],
              redNear: overlayRedTeams[0],
              redFar: overlayRedTeams[1],
            },
          ),
    [
      sessionMode,
      robotConfig.footprintWidth,
      robotConfig.footprintLength,
      overlayBlueTeams,
      overlayRedTeams,
    ],
  );
  const practiceRobotsRef = useRef(practiceRobots);
  practiceRobotsRef.current = practiceRobots;

  const debugZones = useMemo(() => getDebugZones(field), [field]);
  const artifactSpawns = useMemo(() => getMatchArtifactStaging(), []);

  const plannedPathPoints = useMemo(() => {
    if (!pathChain) return [];
    return pathChainToPoints(pathChain, 80).map((p) => ({ x: p.x, y: p.y }));
  }, [pathChain]);

  useEffect(() => {
    followerRef.current.updateConstants({ mass: robotConfig.mass });
  }, [robotConfig.mass]);

  const patchRobotConfig = useCallback((patch: Partial<SimRobotConfig>) => {
    setRobotConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyRobotPreset = useCallback((presetId: string) => {
    if (presetId === 'mecanum-default') {
      setRobotConfig({ ...DEFAULT_SIM_ROBOT_CONFIG });
    }
  }, []);

  const applyParsedPath = useCallback(
    (parsed: ReturnType<typeof parsePathFileText>, source: LoadedPathId = 'upload') => {
      setBasePathChain(parsed.chain);
      setBaseAutoSequence(parsed.autoSequence ?? null);
      setPathFormat(parsed.format);
      setPathWarnings(parsed.warnings);
      setPathError(null);
      setShowPlannedPath(true);
      setLoadedPathId(source);
      const chain = pathChainForAlliance(parsed.chain, alliance);
      pathChainRef.current = chain;
      autoSequenceRef.current = parsed.autoSequence
        ? autoSequenceForAlliance(parsed.autoSequence, alliance)
        : null;
      resetRobotRef.current(getPathStartPose(chain));
    },
    [alliance],
  );

  const clearPath = useCallback(() => {
    followerRef.current.cancelPath();
    pathChainRef.current = null;
    autoSequenceRef.current = null;
    setBasePathChain(null);
    setBaseAutoSequence(null);
    setPathFormat(null);
    setPathWarnings([]);
    setPathError(null);
    setLoadedPathId(null);
    resetRobotRef.current(playerSpawnPose());
  }, [alliance]);

  const startAutoPathRunner = useCallback(() => {
    followerRef.current.setPose(poseRef.current);
    const sequence = autoSequenceRef.current;
    if (sequence && sequence.steps.length > 0) {
      followerRef.current.start(sequence.steps);
      return;
    }
    if (pathChainRef.current) {
      followerRef.current.followPath(pathChainRef.current);
    }
  }, []);

  const loadPathFromText = useCallback(
    (text: string, source: LoadedPathId = 'upload') => {
      if (text.length > 512 * 1024) {
        throw new Error('Path file too large (max 512 KB)');
      }
      applyParsedPath(parsePathFileText(text), source);
    },
    [applyParsedPath],
  );

  const loadBuiltinPath = useCallback(
    async (id: BuiltinPathId) => {
      const entry = BUILTIN_PATHS.find((path) => path.id === id);
      if (!entry) return;
      try {
        const res = await fetch(entry.file);
        if (!res.ok) throw new Error(`Failed to load ${entry.label}`);
        loadPathFromText(await res.text(), id);
      } catch (e) {
        setPathError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadPathFromText],
  );

  const loadPathJson = useCallback(
    (json: PedroJsonFile) => {
      applyParsedPath(parsePathFileText(JSON.stringify(json)), 'upload');
    },
    [applyParsedPath],
  );

  const handlePathUpload = useCallback(
    async (file: File) => {
      setPathError(null);
      try {
        if (file.size > 512 * 1024) {
          throw new Error('Path file too large (max 512 KB)');
        }
        loadPathFromText(await file.text());
      } catch (e) {
        setPathError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadPathFromText],
  );

  const startPose = useMemo(
    () => (pathChain ? getPathStartPose(pathChain) : playerSpawnPose()),
    [pathChain],
  );

  const effectiveStartPose = startPose;

  const [followerHud, setFollowerHud] = useState<{
    errors: { translational: number; heading: number; drive: number };
    progress: { completion: number; distanceRemaining: number };
    target: { x: number; y: number; heading: number } | null;
  } | null>(null);

  const match = useMatchClock();
  const { snapshot: matchSnap } = match;
  const displayMatchSnap = isNetActive ? (net.matchSnapshot ?? NET_SETUP_SNAPSHOT) : matchSnap;
  useMatchAudio(displayMatchSnap, { enabled: matchSounds, volume: matchSoundVolume });

  const allowsDriveRef = useRef(matchSnap.allowsDrive);
  const matchActiveRef = useRef(matchSnap.running && !matchSnap.paused);
  const getMatchSnapshotRef = useRef(() => match.clockRef.current!.snapshot());
  const getMatchStateRef = useRef<() => import('@ftc-sim/game-decode').MatchState | null>(() => null);
  const onPhysicsStepRef = useRef(match.tick);
  allowsDriveRef.current = matchSnap.allowsDrive;
  matchActiveRef.current = matchSnap.running && !matchSnap.paused;
  getMatchSnapshotRef.current = () => match.clockRef.current!.snapshot();
  onPhysicsStepRef.current = match.tick;

  const getMatchState = useCallback(() => getMatchStateRef.current(), []);

  const driveEnabled =
    !editBarriers &&
    !editZones &&
    (isNetActive
      ? Boolean(net.robotId) && displayMatchSnap.allowsDrive
      : displayMatchSnap.allowsDrive);
  const listenForInput =
    isNetActive ||
    displayMatchSnap.phase === 'auto' ||
    displayMatchSnap.phase === 'transition' ||
    displayMatchSnap.phase === 'teleop';
  const { samplerRef, sampleInput, updateHud, controlSource, gamepadConnected, driveDebug, setInjectInput, resetGamepad } =
    useDriveInput(driveEnabled, listenForInput);

  const onHudTick = useCallback(
    (debug: NonNullable<typeof driveDebug>, source: string, connected: boolean) => {
      updateHud(debug, source as typeof controlSource, connected);
    },
    [updateHud],
  );

  const onSimHudTick = useCallback(() => {
    match.syncUi();
    const snap = match.clockRef.current?.snapshot();
    if (
      snap &&
      (snap.phase === 'auto' || snap.phase === 'transition') &&
      hasActiveDriveInput(samplerRef.current)
    ) {
      followerRef.current.cancelPath();
      match.startTeleop();
    }
    const follower = followerRef.current;
    if (follower.isRunning()) {
      setFollowerHud({
        errors: follower.getErrors(),
        progress: follower.getProgress(),
        target: follower.getTargetPose(),
      });
    } else {
      setFollowerHud(null);
    }
  }, [match.syncUi, match.startTeleop, match.clockRef, samplerRef]);

  const {
    pose,
    poseRef,
    speed,
    angularSpeed,
    ready: physicsReady,
    reset: resetRobot,
    physicsEvents,
    getTelemetry,
    liveArtifacts,
    liveArtifactsRef,
    matchGameState,
    mechanismDebugLogs,
    setArtifactFriction: applyArtifactFriction,
    randomizeMotif,
    finalizeMatch,
    fieldRobotsRef,
    fieldRobotCatalog,
  } = usePhysicsRobot(
    field,
    barriers,
    startPose,
    samplerRef,
    sampleInput,
    !editBarriers && !editZones && !isNetSession,
    !isNetSession,
    onHudTick,
    {
      allowsDriveRef,
      matchActiveRef,
      getMatchSnapshotRef,
      followerRef,
      robotConfigRef,
      onPhysicsStepRef,
      onSimHudTick: onSimHudTick,
      alliance,
      artifactStaging: artifactSpawns,
      artifactFrictionRef,
      getMatchStateRef,
      practiceRobotsRef,
      playerTeamNumber: overlayBlueTeams[0],
    },
  );

  const displayMatchGameState = isNetActive ? net.gameState : matchGameState;
  getMatchStateRef.current = () => displayMatchGameState;

  resetRobotRef.current = resetRobot;

  useEffect(() => {
    netArtifactsRef.current = net.liveArtifacts;
  }, [net.liveArtifacts]);

  useEffect(() => {
    if (!isNetActive || !net.robotId) return;
    let frame = 0;
    const sendLoop = () => {
      const sample = sampleInput.current();
      net.sendInput({
        robotId: net.robotId ?? 'player',
        drive: {
          forward: sample.input.forward,
          strafe: sample.input.strafe,
          turn: sample.input.turn,
          brake: sample.input.brake,
          endpointBrake: sample.input.endpointBrake,
        },
        mechanism: {
          intake: sample.mechanism.command.intake,
          shoot: sample.mechanism.shootHeld,
          gate: sample.mechanism.command.gate,
        },
        shootEdge: sample.mechanism.shootEdge,
        gateEdge: sample.mechanism.gateEdge,
      });
      frame = requestAnimationFrame(sendLoop);
    };
    frame = requestAnimationFrame(sendLoop);
    return () => cancelAnimationFrame(frame);
  }, [isNetActive, net.robotId, net.sendInput, sampleInput]);

  const displayFieldReady = isNetActive ? net.connected : physicsReady;
  const displayFieldRobotsRef = isNetActive ? net.fieldRobotsRef : fieldRobotsRef;
  const displayFieldRobotCatalog = isNetActive ? net.fieldRobotCatalog : fieldRobotCatalog;
  const displayLiveArtifacts = isNetActive ? net.liveArtifacts : liveArtifacts;
  const displayLiveArtifactsRef = isNetActive ? netArtifactsRef : liveArtifactsRef;

  const displayOverlayTeams = useMemo(
    () =>
      isNetActive
        ? overlayTeamsFromCatalog(displayFieldRobotCatalog, {
            red: overlayRedTeams,
            blue: overlayBlueTeams,
          })
        : { red: overlayRedTeams, blue: overlayBlueTeams },
    [isNetActive, displayFieldRobotCatalog, overlayRedTeams, overlayBlueTeams],
  );

  const prevMatchPhaseRef = useRef(displayMatchSnap.phase);
  useEffect(() => {
    const prev = prevMatchPhaseRef.current;
    prevMatchPhaseRef.current = displayMatchSnap.phase;
    if (prev === 'teleop' && displayMatchSnap.phase === 'post') {
      finalizeMatch();
    }
  }, [displayMatchSnap.phase, finalizeMatch]);

  useEffect(() => {
    if (!basePathChain || !physicsReady) return;
    const chain = pathChainForAlliance(basePathChain, alliance);
    pathChainRef.current = chain;
    autoSequenceRef.current = baseAutoSequence
      ? autoSequenceForAlliance(baseAutoSequence, alliance)
      : null;

    const snap = match.clockRef.current?.snapshot();
    const midMatch =
      snap &&
      snap.running &&
      snap.phase !== 'setup' &&
      snap.phase !== 'init' &&
      snap.phase !== 'post';

    if (midMatch) {
      return;
    }

    followerRef.current.cancelPath();
    resetRobotRef.current(getPathStartPose(chain));
  }, [alliance, baseAutoSequence, basePathChain, physicsReady, match.clockRef]);

  useEffect(() => {
    if (!physicsReady) return;
    applyArtifactFriction(artifactFriction);
  }, [artifactFriction, physicsReady, applyArtifactFriction]);

  useEffect(() => {
    if (!physicsReady) return;
    return installFtcSimDevApi({
      setInjectInput,
      getTelemetry,
      resetGamepad,
      resetRobot,
      getMatchSnapshot: () => match.clockRef.current?.snapshot() ?? matchSnap,
      getPose: () => poseRef.current,
      getSpeed: () => speed,
      loadPathJson,
      loadPathFromText,
      getPathChain: () => pathChainRef.current,
      clearPath,
      getFollower: () => followerRef.current,
      startAuto: () => {
        match.initMatch();
        match.start();
        startAutoPathRunner();
      },
    });
  }, [
    physicsReady,
    setInjectInput,
    getTelemetry,
    resetGamepad,
    resetRobot,
    match.clockRef,
    match.initMatch,
    match.start,
    matchSnap,
    poseRef,
    speed,
    loadPathJson,
    loadPathFromText,
    clearPath,
    startAutoPathRunner,
  ]);

  useEffect(() => {
    setSelectedVertex((prev) => clampMapSelection(barriers, zones, prev));
  }, [barriers, zones]);

  useEffect(() => {
    fieldCenterRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!selectedVertex) return;
    const editing =
      (selectedVertex.layer === 'barrier' && editBarriers) ||
      (selectedVertex.layer === 'zone' && editZones);
    if (!editing) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();

      if (selectedVertex.layer === 'barrier') {
        if (e.shiftKey) {
          setBarriers((prev) => deleteBarrier(prev, selectedVertex.barrierId));
          setSelectedVertex(null);
          return;
        }
        setBarriers((prev) =>
          deleteBarrierVertex(prev, selectedVertex.barrierId, selectedVertex.vertexIndex),
        );
        return;
      }

      setZones((prev) =>
        deleteZoneVertex(prev, selectedVertex.zoneId, selectedVertex.vertexIndex),
      );
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editBarriers, editZones, selectedVertex]);

  const onMoveBarrierVertex = useCallback(
    (barrierId: string, vertexIndex: number, point: Vector2) => {
      setBarriers((prev) => moveBarrierVertex(prev, barrierId, vertexIndex, point));
    },
    [],
  );

  const onMoveZoneVertex = useCallback((zoneId: string, vertexIndex: number, point: Vector2) => {
    setZones((prev) => moveZoneVertex(prev, zoneId, vertexIndex, point));
  }, []);

  const resetBarriers = () => {
    setBarriers(initEditableBarriers(field));
    setSelectedVertex(null);
  };

  const resetZones = () => {
    setZones(initEditableZones(field));
    setSelectedVertex(null);
  };

  const copyZonesJson = async () => {
    try {
      await navigator.clipboard.writeText(zonesToExportJson(zones));
      setCopyStatus('Copied launch zone JSON');
    } catch {
      setCopyStatus('Copy failed');
    }
  };

  const copyBarriersJson = async () => {
    try {
      await navigator.clipboard.writeText(barriersToExportJson(barriers));
      setCopyStatus('Copied goal JSON');
    } catch {
      setCopyStatus('Copy failed');
    }
  };

  const selectedVertexCoords = (() => {
    if (!selectedVertex) return null;
    if (selectedVertex.layer === 'barrier') {
      const barrier = barriers.find((b) => b.id === selectedVertex.barrierId);
      return barrier?.vertices[selectedVertex.vertexIndex] ?? null;
    }
    const zone = zones.find((z) => z.id === selectedVertex.zoneId);
    return zone?.vertices[selectedVertex.vertexIndex] ?? null;
  })();

  const resetField = () => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand('reset');
      return;
    }
    followerRef.current.cancelPath();
    match.reset();
    resetRobot(effectiveStartPose);
    setBarriers(initEditableBarriers(field));
    setZones(initEditableZones(field));
    setSelectedVertex(null);
    setFollowerHud(null);
    clearPath();
  };

  const handleInit = () => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand('init');
      return;
    }
    randomizeMotif();
    match.initMatch();
  };

  const handleStartAuto = () => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand('start_auto');
      return;
    }
    if (matchSnap.phase === 'setup') {
      randomizeMotif();
    }
    if (matchSnap.phase === 'setup' || matchSnap.phase === 'init') {
      match.start();
    } else {
      match.startAuto();
    }
    if (pathChainRef.current || autoSequenceRef.current) {
      startAutoPathRunner();
    }
  };

  const handleStartTeleop = () => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand('teleop');
      return;
    }
    match.startTeleop();
  };

  const handleInfinitePractice = () => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand('infinite');
      return;
    }
    match.startInfinitePractice();
  };

  const handlePause = () => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand(displayMatchSnap.paused ? 'resume' : 'pause');
      return;
    }
    if (matchSnap.paused) match.resume();
    else match.pause();
  };

  const handleEndMatch = useCallback(() => {
    if (isNetActive && net.role === 'host') {
      net.sendHostCommand('end_match');
      setCeremonyTrigger((n) => n + 1);
      return;
    }
    finalizeMatch();
    match.endMatch();
    setCeremonyTrigger((n) => n + 1);
  }, [finalizeMatch, match, isNetActive, net.role, net.sendHostCommand]);

  const phaseLabel = displayMatchSnap.infiniteMode ? 'teleop ∞' : displayMatchSnap.phase;
  const clockLabel =
    displayMatchSnap.infiniteMode && displayMatchSnap.phase === 'teleop'
      ? '∞'
      : displayMatchSnap.phase === 'auto' ||
          displayMatchSnap.phase === 'transition' ||
          displayMatchSnap.phase === 'teleop'
        ? `${displayMatchSnap.timeRemainingInPhase.toFixed(1)}s`
        : '—';

  const isNetHost = isNetActive && sessionMode === 'host';
  const isNetJoinPlayer = isNetActive && sessionMode === 'join';
  const isNetDriver = isNetActive && Boolean(net.robotId);
  const isNetLobby = isNetActive && !net.robotId;
  const showSidePanels = !isNetJoinPlayer;
  const showHostNavActions = !isNetActive || isNetHost;
  const showMatchNav = !isNetJoinPlayer || isNetLobby;
  const isNetSpectator = isNetActive && !isNetDriver && net.role !== 'host';
  const matchControlsLocked = isNetSpectator;

  let canInit = displayMatchSnap.phase === 'setup';
  let canStartAuto = displayMatchSnap.phase === 'init';
  let canTeleop = displayMatchSnap.phase !== 'teleop' && displayMatchSnap.phase !== 'post';
  let canInfinite =
    displayMatchSnap.phase !== 'post' &&
    !(displayMatchSnap.infiniteMode && displayMatchSnap.phase === 'teleop');
  let canPause =
    displayMatchSnap.running &&
    displayMatchSnap.phase !== 'setup' &&
    displayMatchSnap.phase !== 'init' &&
    displayMatchSnap.phase !== 'post';
  let canEndMatch =
    !ceremonyActive &&
    displayMatchSnap.phase !== 'setup' &&
    displayMatchSnap.phase !== 'init' &&
    displayMatchSnap.phase !== 'post';

  if (isNetHost) {
    canInit = !ceremonyActive && displayMatchSnap.phase !== 'init';
    canStartAuto = displayMatchSnap.phase === 'init';
    canTeleop =
      displayMatchSnap.phase === 'init' ||
      displayMatchSnap.phase === 'auto' ||
      displayMatchSnap.phase === 'transition';
    canInfinite =
      displayMatchSnap.phase !== 'post' &&
      !(displayMatchSnap.infiniteMode && displayMatchSnap.phase === 'teleop');
  }

  const displayPose = isNetActive && net.pose ? net.pose : pose;
  const headingDeg = (displayPose.heading * 180) / Math.PI;
  const coordLabel = hover
    ? `(${hover.x.toFixed(1)}, ${hover.y.toFixed(1)}) in`
    : `Robot (${displayPose.x.toFixed(1)}, ${displayPose.y.toFixed(1)}, ${headingDeg.toFixed(0)}°)`;

  return (
    <div className={`shell alliance-${alliance}`}>
      <LobbyScreen
        initialMode={sessionMode}
        initialAddress={urlSession.address ?? '127.0.0.1:5191'}
        initialName={urlSession.displayName ?? 'Driver'}
        connected={net.connected}
        connecting={net.connecting}
        error={net.error}
        role={net.role}
        robotId={net.robotId}
        playerId={net.playerId}
        roomPlayers={net.roomPlayers}
        slotError={net.slotError}
        lanAddress={net.lanAddress}
        rttMs={net.rttMs}
        matchPhase={displayMatchSnap.phase}
        onChooseSolo={() => {
          net.disconnect();
          setSessionMode('solo');
        }}
        onConnect={(mode, address, name) => {
          setSessionMode(mode);
          net.connect(address, name, mode === 'host' ? 'host' : 'join');
        }}
        onDisconnect={() => {
          net.disconnect();
          setSessionMode('solo');
        }}
        onClaimSlot={(slotId, teamLabel) => net.claimSlot(slotId, teamLabel)}
        onHostStartDriving={() => net.sendHostCommand('infinite')}
      />
      {showMatchNav && (
      <nav className="panels-nav" aria-label="Simulator controls">
        <div className="panels-nav__brand">
          <PanelsLogo />
          <span className="panels-nav__title">DECODE Sim</span>
          {isNetHost && <span className="panels-nav__net-badge panels-nav__net-badge--host">HOST</span>}
          {isNetLobby && net.role === 'host' && (
            <span className="panels-nav__net-badge panels-nav__net-badge--driver">LOBBY</span>
          )}
          {isNetDriver && !isNetHost && (
            <span className="panels-nav__net-badge panels-nav__net-badge--driver">DRIVER</span>
          )}
          {isNetLobby && net.role !== 'host' && (
            <span className="panels-nav__net-badge panels-nav__net-badge--driver">PICK ROBOT</span>
          )}
          {isNetSpectator && (
            <span className="panels-nav__net-badge panels-nav__net-badge--spectator">SPECTATING</span>
          )}
        </div>

        <div className="panels-nav__status">
          <span className="status-dot" aria-hidden />
          <span>{phaseLabel}</span>
          <span className="panels-nav__stats">
            <span className="coord-readout">{coordLabel}</span>
            <span>Clock {clockLabel}</span>
            <span>Elapsed {displayMatchSnap.timeElapsed.toFixed(1)}s</span>
          </span>
        </div>

        <div className="panels-nav__actions">
          {showHostNavActions && (
            <>
          <PanelsButton disabled={matchControlsLocked || !canInit} onClick={handleInit}>
            INIT
          </PanelsButton>
          <PanelsButton variant="primary" disabled={matchControlsLocked || !canStartAuto} onClick={handleStartAuto}>
            START AUTO
          </PanelsButton>
          <PanelsButton disabled={matchControlsLocked || !canTeleop} onClick={handleStartTeleop}>
            TELEOP
          </PanelsButton>
          <PanelsButton disabled={matchControlsLocked || !canInfinite} onClick={handleInfinitePractice}>
            INF
          </PanelsButton>
          <PanelsButton disabled={matchControlsLocked || !canPause} onClick={handlePause}>
            {displayMatchSnap.paused ? 'RESUME' : 'PAUSE'}
          </PanelsButton>
          <PanelsButton disabled={matchControlsLocked || !canEndMatch} onClick={handleEndMatch}>
            END MATCH
          </PanelsButton>
          <PanelsButton disabled={matchControlsLocked} onClick={resetField}>
            RESET
          </PanelsButton>
            </>
          )}
        </div>
      </nav>
      )}

      <div className={`panels-body${isNetJoinPlayer ? ' panels-body--join' : ''}`}>
        {showSidePanels && (
        <div className="panels-column">
          <PanelSection title="Alliance" badge={alliance === 'blue' ? 'Blue' : 'Red'}>
            <div className="alliance-toggle">
              <PanelsButton
                variant={alliance === 'blue' ? 'primary' : 'default'}
                onClick={() => setAlliance('blue')}
              >
                Blue
              </PanelsButton>
              <PanelsButton
                variant={alliance === 'red' ? 'primary' : 'default'}
                onClick={() => setAlliance('red')}
              >
                Red
              </PanelsButton>
            </div>
          </PanelSection>

          <PanelSection title="Robot" badge={`${robotConfig.footprintLength}×${robotConfig.footprintWidth} in`}>
            <p className="hint">
              Tune drive limits for teleop and AUTO. Weight affects path follower centripetal correction.
            </p>
            <label className="panel-field">
              Preset
              <select
                className="panel-select"
                value={robotConfig.presetId}
                onChange={(e) => applyRobotPreset(e.target.value)}
              >
                {SIM_ROBOT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="panel-label">
              Top speed: <strong>{robotConfig.maxVelocity.toFixed(0)} in/s</strong>
              <input
                type="range"
                min={10}
                max={80}
                step={1}
                value={robotConfig.maxVelocity}
                onChange={(e) => patchRobotConfig({ maxVelocity: Number(e.target.value) })}
              />
            </label>
            <label className="panel-label">
              Acceleration: <strong>{robotConfig.maxAcceleration.toFixed(0)} in/s²</strong>
              <input
                type="range"
                min={12}
                max={120}
                step={1}
                value={robotConfig.maxAcceleration}
                onChange={(e) => patchRobotConfig({ maxAcceleration: Number(e.target.value) })}
              />
            </label>
            <label className="panel-label">
              Weight: <strong>{robotConfig.mass.toFixed(0)} lb</strong>
              <input
                type="range"
                min={5}
                max={40}
                step={1}
                value={robotConfig.mass}
                onChange={(e) => patchRobotConfig({ mass: Number(e.target.value) })}
              />
            </label>
            <label className="panel-label">
              Turn speed: <strong>{robotConfig.maxAngularVelocity.toFixed(1)} rad/s</strong>
              <input
                type="range"
                min={1}
                max={8}
                step={0.1}
                value={robotConfig.maxAngularVelocity}
                onChange={(e) => patchRobotConfig({ maxAngularVelocity: Number(e.target.value) })}
              />
            </label>
            <label className="panel-label">
              Turn acceleration: <strong>{robotConfig.maxAngularAcceleration.toFixed(0)} rad/s²</strong>
              <input
                type="range"
                min={6}
                max={36}
                step={1}
                value={robotConfig.maxAngularAcceleration}
                onChange={(e) =>
                  patchRobotConfig({ maxAngularAcceleration: Number(e.target.value) })
                }
              />
            </label>
            <label className="panel-label">
              Length: <strong>{robotConfig.footprintLength.toFixed(0)} in</strong>
              <input
                type="range"
                min={12}
                max={24}
                step={1}
                value={robotConfig.footprintLength}
                onChange={(e) => patchRobotConfig({ footprintLength: Number(e.target.value) })}
              />
            </label>
            <label className="panel-label">
              Width: <strong>{robotConfig.footprintWidth.toFixed(0)} in</strong>
              <input
                type="range"
                min={12}
                max={24}
                step={1}
                value={robotConfig.footprintWidth}
                onChange={(e) => patchRobotConfig({ footprintWidth: Number(e.target.value) })}
              />
            </label>
            <ul className="metrics">
              <li>
                Speed: <strong>{speed.toFixed(1)} in/s</strong>
              </li>
              <li>
                Turn rate: <strong>{angularSpeed.toFixed(2)} rad/s</strong>
              </li>
            </ul>
          </PanelSection>

          <PanelSection title="Artifacts" badge={`μ ${artifactFriction.toFixed(2)}`}>
            <p className="hint">
              Tune ball sliding. Low = ice; high = stops quickly. Also updates Rapier contact friction.
            </p>
            <label className="panel-label">
              Surface friction: <strong>{artifactFriction.toFixed(2)}</strong>
              <input
                type="range"
                min={0.1}
                max={1.5}
                step={0.05}
                value={artifactFriction}
                onChange={(e) => setArtifactFriction(Number(e.target.value))}
              />
            </label>
          </PanelSection>

          <PanelSection title="Teleop" badge={matchSnap.phase}>
            <p className="hint">
              Field-centric drive: left stick moves on the field (W = north, D = east). Right stick
              X rotates. Shift or left bumper brakes. LT / F = intake, RT / Space = shoot (hold for rapid fire every 0.2s).
              Drive into a gate zone (robot footprint overlaps teal box) to auto-release ramp balls.
            </p>
            <ul className="metrics">
              <li>
                Match: <strong>{matchSnap.phase}</strong>
              </li>
              <li>
                Control: <strong>{matchSnap.controlSource}</strong>
              </li>
              <li>
                Input: <strong>{controlSource}</strong>
              </li>
              <li>
                Gamepad: <strong>{gamepadConnected ? 'connected' : 'none'}</strong>
              </li>
              <li>
                Pose: ({pose.x.toFixed(1)}, {pose.y.toFixed(1)}, {headingDeg.toFixed(0)}°)
              </li>
              {driveDebug && (
                <>
                  <li>
                    Drive: f={driveDebug.forward.toFixed(2)} s={driveDebug.strafe.toFixed(2)} t={
                      driveDebug.turn.toFixed(2)
                    }
                  </li>
                  <li>
                    Deadzone: f={driveDebug.rawForward.toFixed(2)} s={driveDebug.rawStrafe.toFixed(2)} t={
                      driveDebug.rawTurn.toFixed(2)
                    }
                  </li>
                  {driveDebug.source === 'gamepad' && (
                    <li>
                      Pad axes: a0={driveDebug.padAxes[0].toFixed(2)} a1={driveDebug.padAxes[1].toFixed(2)} a2={
                        driveDebug.padAxes[2].toFixed(2)
                      } a3={driveDebug.padAxes[3].toFixed(2)}
                    </li>
                  )}
                  <li>
                    Intake: <strong>{driveDebug.intake.toFixed(2)}</strong> · Shoot:{' '}
                    <strong>{driveDebug.shoot ? 'fire' : '—'}</strong> · Gate:{' '}
                    <strong>{driveDebug.gate ? 'open' : '—'}</strong>
                  </li>
                </>
              )}
            </ul>
            {(editBarriers || editZones) && (
              <p className="hint">Turn off map editing to drive the robot.</p>
            )}
            {!matchSnap.allowsDrive && !editBarriers && !editZones && (
              <p className="hint">Drive enabled in teleop only. INIT → START AUTO → TELEOP, or INF for endless practice.</p>
            )}
          </PanelSection>

          <PanelSection
            key={pathChain ? 'path-loaded' : 'path-empty'}
            title="Path"
            badge={
              pathChain
                ? `${pathChain.paths.length} seg · ${pathChain.totalLength().toFixed(0)} in`
                : 'none'
            }
            defaultOpen={!!pathChain}
          >
            <p className="hint">
              Pick a bundled path or upload PedroJSON (.json) / Visualizer export (.pp).
            </p>
            <label className="panel-field">
              Path
              <select
                className="panel-select"
                value={selectedPathId}
                onChange={(e) => setSelectedPathId(e.target.value as BuiltinPathId)}
              >
                {BUILTIN_PATHS.map((path) => (
                  <option key={path.id} value={path.id}>
                    {path.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="barrier-actions">
              <PanelsButton onClick={() => void loadBuiltinPath(selectedPathId)}>
                Add path
              </PanelsButton>
            </div>
            <label className="panel-check">
              <input
                type="file"
                accept=".json,.pp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePathUpload(file);
                  e.target.value = '';
                }}
              />
              Upload path (.json / .pp)
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showPlannedPath}
                disabled={!pathChain}
                onChange={(e) => setShowPlannedPath(e.target.checked)}
              />
              Show planned path
            </label>
            <ul className="metrics">
              <li>
                Loaded: <strong>{pathChain ? 'yes' : 'no'}</strong>
              </li>
              {pathFormat && (
                <li>
                  Format: <strong>{pathFormat}</strong>
                </li>
              )}
              {loadedPathId && (
                <li>
                  Name:{' '}
                  <strong>
                    {loadedPathId === 'upload'
                      ? 'Custom upload'
                      : BUILTIN_PATHS.find((path) => path.id === loadedPathId)?.label}
                  </strong>
                </li>
              )}
              {pathChain && (
                <>
                  <li>
                    Segments: <strong>{pathChain.paths.length}</strong>
                  </li>
                  <li>
                    Length: <strong>{pathChain.totalLength().toFixed(1)} in</strong>
                  </li>
                  <li>
                    Points: <strong>{plannedPathPoints.length}</strong>
                  </li>
                  <li>
                    Start:{' '}
                    <strong>
                      ({plannedPathPoints[0]?.x.toFixed(1)}, {plannedPathPoints[0]?.y.toFixed(1)})
                    </strong>
                  </li>
                  <li>
                    End:{' '}
                    <strong>
                      (
                      {plannedPathPoints[plannedPathPoints.length - 1]?.x.toFixed(1)},{' '}
                      {plannedPathPoints[plannedPathPoints.length - 1]?.y.toFixed(1)})
                    </strong>
                  </li>
                </>
              )}
            </ul>
            {pathError && <p className="hint path-error">{pathError}</p>}
            {pathWarnings.map((warning) => (
              <p key={warning} className="hint">
                {warning}
              </p>
            ))}
            {followerHud && (
              <ul className="metrics">
                <li>
                  Progress: <strong>{(followerHud.progress.completion * 100).toFixed(0)}%</strong>
                </li>
                <li>
                  Trans. error: <strong>{followerHud.errors.translational.toFixed(2)} in</strong>
                </li>
                <li>
                  Heading error: <strong>{followerHud.errors.heading.toFixed(3)} rad</strong>
                </li>
                <li>
                  Remaining: <strong>{followerHud.progress.distanceRemaining.toFixed(1)} in</strong>
                </li>
              </ul>
            )}
          </PanelSection>

          <PanelSection
            title="Overlays & zones"
            badge={editZones ? 'editing zones' : showZones ? 'grid on' : 'grid off'}
          >
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showZones}
                onChange={(e) => setShowZones(e.target.checked)}
              />
              Launch zones + tile grid
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showGateDetector}
                onChange={(e) => setShowGateDetector(e.target.checked)}
              />
              Gate debug (teal zone + robot footprint — green when overlapping)
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showDebugZones}
                onChange={(e) => setShowDebugZones(e.target.checked)}
              />
              Scoring zones (basin, ramp, base)
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showArtifacts}
                onChange={(e) => setShowArtifacts(e.target.checked)}
              />
              Game pieces (live artifacts)
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showCenterLine}
                onChange={(e) => setShowCenterLine(e.target.checked)}
              />
              Center line (x=72)
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showBarriers}
                onChange={(e) => setShowBarriers(e.target.checked)}
              />
              Goal barriers
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={showMatchOverlay}
                onChange={(e) => setShowMatchOverlay(e.target.checked)}
              />
              FTC match timer overlay
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={editZones}
                onChange={(e) => setEditZones(e.target.checked)}
              />
              Edit launch zones
            </label>
            <p className="hint">
              Map near and far launch areas. Drag handles. Delete removes the selected vertex.
            </p>
            {editZones && (
              <>
                <ul className="barrier-list">
                  {zones.map((zone) => (
                    <li key={zone.id}>
                      <button
                        type="button"
                        className={`barrier-list__item${selectedVertex?.layer === 'zone' && selectedVertex.zoneId === zone.id ? ' barrier-list__item--active' : ''}`}
                        onClick={() => setSelectedVertex(zoneSelection(zone.id, 0))}
                      >
                        {zone.label}
                        <span>{zone.vertices.length} vertices</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {selectedVertexCoords && selectedVertex?.layer === 'zone' && (
                  <p className="barrier-selection">
                    Vertex {selectedVertex.vertexIndex + 1}: ({selectedVertexCoords.x.toFixed(1)},{' '}
                    {selectedVertexCoords.y.toFixed(1)})
                  </p>
                )}
                <div className="barrier-actions">
                  <PanelsButton
                    disabled={selectedVertex?.layer !== 'zone'}
                    onClick={() => {
                      if (selectedVertex?.layer !== 'zone') return;
                      setZones((prev) =>
                        deleteZoneVertex(
                          prev,
                          selectedVertex.zoneId,
                          selectedVertex.vertexIndex,
                        ),
                      );
                    }}
                  >
                    Delete vertex
                  </PanelsButton>
                  <PanelsButton onClick={resetZones}>Reset defaults</PanelsButton>
                  <PanelsButton onClick={copyZonesJson}>Copy JSON</PanelsButton>
                </div>
                {copyStatus && <p className="hint">{copyStatus}</p>}
              </>
            )}
          </PanelSection>

          <PanelSection title="Broadcast HUD" badge={overlayMatchName}>
            <p className="hint">
              Labels shown on the FTC Live scoreboard overlay. Team fields accept any text.
            </p>
            <label className="panel-field">
              Event name
              <input
                className="panel-select"
                type="text"
                value={overlayEventName}
                onChange={(e) => setOverlayEventName(e.target.value)}
              />
            </label>
            <label className="panel-field">
              Match name
              <input
                className="panel-select"
                type="text"
                value={overlayMatchName}
                onChange={(e) => setOverlayMatchName(e.target.value)}
              />
            </label>
            <label className="panel-field">
              Red team 1
              <input
                className="panel-select"
                type="text"
                value={overlayRedTeams[0]}
                onChange={(e) =>
                  setOverlayRedTeams(([_, second]) => [e.target.value, second])
                }
              />
            </label>
            <label className="panel-field">
              Red team 2
              <input
                className="panel-select"
                type="text"
                value={overlayRedTeams[1]}
                onChange={(e) =>
                  setOverlayRedTeams(([first]) => [first, e.target.value])
                }
              />
            </label>
            <label className="panel-field">
              Blue team 1
              <input
                className="panel-select"
                type="text"
                value={overlayBlueTeams[0]}
                onChange={(e) =>
                  setOverlayBlueTeams(([_, second]) => [e.target.value, second])
                }
              />
            </label>
            <label className="panel-field">
              Blue team 2
              <input
                className="panel-select"
                type="text"
                value={overlayBlueTeams[1]}
                onChange={(e) =>
                  setOverlayBlueTeams(([first]) => [first, e.target.value])
                }
              />
            </label>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={matchSounds}
                onChange={(e) => setMatchSounds(e.target.checked)}
              />
              Match sounds (FTC Live audio)
            </label>
            <label className="panel-label">
              Game volume: <strong>{Math.round(matchSoundVolume * 100)}%</strong>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(matchSoundVolume * 100)}
                disabled={!matchSounds}
                onChange={(e) => setMatchSoundVolume(Number(e.target.value) / 100)}
              />
            </label>
          </PanelSection>

          <PanelSection title="Goals" badge={editBarriers ? 'editing' : undefined}>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={editBarriers}
                onChange={(e) => setEditBarriers(e.target.checked)}
              />
              Edit goal barriers
            </label>
            {editBarriers && (
              <>
                <ul className="barrier-list">
                  {barriers.map((barrier) => (
                    <li key={barrier.id}>
                      <button
                        type="button"
                        className={`barrier-list__item${selectedVertex?.layer === 'barrier' && selectedVertex.barrierId === barrier.id ? ' barrier-list__item--active' : ''}`}
                        onClick={() => setSelectedVertex(barrierSelection(barrier.id, 0))}
                      >
                        {barrier.label}
                        <span>{barrier.vertices.length} vertices</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="barrier-actions">
                  <PanelsButton onClick={resetBarriers}>Reset goals</PanelsButton>
                  <PanelsButton onClick={copyBarriersJson}>Copy goal JSON</PanelsButton>
                </div>
              </>
            )}
          </PanelSection>

          <PanelSection title="Build Roadmap" badge="Phase 8">
            <ul className="phase-list">
              {PHASES.map((phase) => (
                <li key={phase.id} data-status={phase.status}>
                  <span>Phase {phase.id}</span>
                  <span>{phase.name}</span>
                </li>
              ))}
            </ul>
          </PanelSection>
        </div>
        )}

        <main
          ref={fieldCenterRef}
          className="panel-center"
          aria-label="Field view"
          tabIndex={0}
          onPointerDown={() => fieldCenterRef.current?.focus()}
        >
          {!displayFieldReady && isNetSession && !net.connected && (
            <div className="field-loading">Connecting to match server…</div>
          )}
          {!displayFieldReady && !isNetSession && (
            <div className="field-loading">Loading drive…</div>
          )}
          <div className="field-stage">
            <FieldCanvas
              field={field}
              barriers={barriers}
              zones={zones}
              showZones={showZones}
              showBarriers={showBarriers}
              showGrid={showZones}
              editBarriers={editBarriers}
              editZones={editZones}
              selectedVertex={selectedVertex}
              onHover={setHover}
              onSelectVertex={setSelectedVertex}
              onMoveBarrierVertex={onMoveBarrierVertex}
              onMoveZoneVertex={onMoveZoneVertex}
              fieldRobotsRef={displayFieldReady ? displayFieldRobotsRef : undefined}
              fieldRobotCatalog={displayFieldReady ? displayFieldRobotCatalog : []}
              plannedPath={plannedPathPoints}
              showPlannedPath={showPlannedPath && plannedPathPoints.length >= 2}
              followerTarget={followerHud?.target ?? null}
              showFollowerOverlay={
                followerHud !== null &&
                (matchSnap.phase === 'auto' || matchSnap.phase === 'transition')
              }
              debugZones={debugZones}
              showDebugZones={showDebugZones}
              showGateDetector={showGateDetector}
              liveArtifactsRef={displayLiveArtifactsRef}
              liveArtifacts={displayLiveArtifacts}
              artifactSpawns={artifactSpawns}
              showArtifacts={showArtifacts}
              showCenterLine={showCenterLine}
              smoothNetMotion={isNetActive}
              netSnapshotTick={net.snapshot?.tick ?? 0}
            />
            <MatchResultsCeremony
              snapshot={displayMatchSnap}
              matchGameState={displayMatchGameState}
              getMatchState={getMatchState}
              triggerKey={ceremonyTrigger}
              audioEnabled={matchSounds}
              volume={matchSoundVolume}
              onActiveChange={setCeremonyActive}
              eventName={overlayEventName}
              matchName={overlayMatchName}
              redTeams={displayOverlayTeams.red}
              blueTeams={displayOverlayTeams.blue}
            />
          </div>
          <MatchFieldOverlay
            snapshot={displayMatchSnap}
            visible={
              (isNetJoinPlayer || showMatchOverlay) &&
              (displayMatchSnap.phase !== 'post' || !ceremonyActive)
            }
            alliance={alliance}
            matchGameState={displayMatchGameState}
            eventName={overlayEventName}
            matchName={overlayMatchName}
            redTeams={displayOverlayTeams.red}
            blueTeams={displayOverlayTeams.blue}
          />
        </main>

        {showSidePanels && (
        <div className="panels-column">
          <PanelSection title="Corner check">
            <ul className="metrics">
              <li>SW (0, 0) — bottom-left</li>
              <li>SE (144, 0) — bottom-right</li>
              <li>NW (0, 144) — top-left</li>
              <li>NE (144, 144) — top-right</li>
            </ul>
            <p className="hint">Hover each corner; readout should match within ~0.2 in.</p>
          </PanelSection>

          <PanelSection title="Start pose">
            <ul className="metrics">
              <li>
                Spawn: ({effectiveStartPose.x.toFixed(0)}, {effectiveStartPose.y.toFixed(0)})
              </li>
              <li>
                Heading: {((effectiveStartPose.heading * 180) / Math.PI).toFixed(0)}°
                {pathChain ? ' (from path)' : ''}
              </li>
            </ul>
          </PanelSection>

          <PanelSection title="Score" badge={`${displayMatchGameState?.score.total ?? 0} pts`}>
            <div className="stat-grid">
              <div>
                Total
                <strong>{displayMatchGameState?.score.total ?? 0}</strong>
              </div>
              <div>
                Classified
                <strong>{displayMatchGameState?.teleopScore.classified ?? 0}</strong>
              </div>
              <div>
                Overflow
                <strong>{displayMatchGameState?.teleopScore.overflow ?? 0}</strong>
              </div>
              <div>
                Base
                <strong>{displayMatchGameState?.teleopScore.base ?? 0}</strong>
              </div>
              <div>
                Held
                <strong>{displayLiveArtifacts.filter((a) => a.phase === 'held').length}</strong>
              </div>
            </div>
            <ul className="metrics score-events">
              {(displayMatchGameState?.events ?? [])
                .slice(-8)
                .reverse()
                .map((event, index) => (
                  <li key={`${event.t}-${index}`}>
                    {event.message}
                  </li>
                ))}
              {(displayMatchGameState?.events.length ?? 0) === 0 && (
                <li className="hint">Intake → shoot from launch zone → score in basin.</li>
              )}
            </ul>
          </PanelSection>

          <PanelSection title="Mechanism debug" badge={`${mechanismDebugLogs.length} logs`} defaultOpen>
            <p className="hint">
              Gate / shoot / intake events. Also printed to browser console (F12). Copy and paste
              after a test match.
            </p>
            <div className="barrier-actions">
              <PanelsButton
                onClick={() => {
                  const text = mechanismDebugLogs
                    .map(
                      (entry) =>
                        `[${entry.category}] t=${entry.t.toFixed(2)} ${entry.message}${
                          entry.data ? ` ${JSON.stringify(entry.data)}` : ''
                        }`,
                    )
                    .join('\n');
                  void navigator.clipboard.writeText(text || '(no mechanism logs yet)');
                  setCopyStatus('Mechanism logs copied to clipboard');
                }}
              >
                Copy logs
              </PanelsButton>
            </div>
            <ul className="metrics score-events mechanism-debug-log">
              {mechanismDebugLogs
                .slice(-24)
                .reverse()
                .map((entry, index) => (
                  <li key={`${entry.t}-${entry.category}-${index}`}>
                    <span className="mechanism-debug-log__cat">[{entry.category}]</span>{' '}
                    {entry.message}
                    {entry.data ? (
                      <span className="mechanism-debug-log__data">
                        {' '}
                        {JSON.stringify(entry.data)}
                      </span>
                    ) : null}
                  </li>
                ))}
              {mechanismDebugLogs.length === 0 && (
                <li className="hint">Drive into gate zone to release balls; RT to shoot — logs appear here.</li>
              )}
            </ul>
          </PanelSection>

          <PanelSection title="Match Analytics">
            <div className="stat-grid">
              <div>
                Score
                <strong>{displayMatchGameState?.score.total ?? 0}</strong>
              </div>
              <div>
                Speed
                <strong>{speed.toFixed(1)} in/s</strong>
              </div>
            </div>
            <ul className="metrics">
              <li>
                Source: <strong>{matchSnap.controlSource}</strong>
              </li>
              <li>
                Omega: <strong>{angularSpeed.toFixed(2)} rad/s</strong>
              </li>
            </ul>
          </PanelSection>
        </div>
        )}
      </div>

      {showSidePanels && (
      <footer className="panels-footer">
        <PanelsButton disabled>Export Replay</PanelsButton>
        <div className="event-log" aria-live="polite">
          {(physicsEvents.length
            ? physicsEvents
            : physicsReady
              ? ['[info] Kinematic drive ready']
              : ['[info] Loading drive…']
          ).map((ev, i) => (
            <div key={i} className="event-line">
              {ev}
            </div>
          ))}
        </div>
      </footer>
      )}
    </div>
  );
}
