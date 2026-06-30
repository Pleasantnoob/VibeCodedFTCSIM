import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import { getDebugZones } from '@ftc-sim/field';
import type { AutoSequence, PathChain, PedroJsonFile, ResolvedAutoProgram } from '@ftc-sim/pedro';
import {
  AutoProgramRunner,
  autoSequenceForAlliance,
  autoSequenceOverlayPoints,
  getPathStartPose,
  loadAutoProgramFromText,
  pathChainForAlliance,
  pathChainToPoints,
  parsePathFileText,
  programStartPose,
} from '@ftc-sim/pedro';
import type { Pose, Vector2 } from '@ftc-sim/field';
import type { SimArtifactState } from '@ftc-sim/mechanisms';
import { BotManager, formatBotDebugLogEntry, defaultPracticeBotSlots, botAutoStartPose, buildBotPathPreviewStates, type BotAutoPath, type BotDebugState, type BotRobotId, type BotSlotConfig, type Difficulty } from '@ftc-sim/bot';
import { netConfigFromBotSlots } from '@ftc-sim/session';
import { usePhysicsRobot } from './robot/usePhysicsRobot';

import {
  DEFAULT_SIM_ROBOT_CONFIG,
  simRobotConfigFromNet,
  simRobotFootprint,
  type SimRobotConfig,
} from './robot/robot-config';
import { type RobotSkinId } from './robot/robot-skins';
import { FieldCanvas } from './field/FieldCanvas';
import {
  barriersToExportJson,
  clampSelection as clampBarrierSelection,
  deleteBarrier,
  deleteBarrierVertex,
  initEditableBarriers,
  moveBarrierVertex,
} from './field/barrier-editor';
import type { MapVertexSelection } from './field/map-selection';
import {
  clampZoneSelection,
  deleteZoneVertex,
  initEditableZones,
  moveZoneVertex,
  zonesToExportJson,
} from './field/zone-editor';
import { useDriveInput } from './input/useDriveInput';
import { DriveControlsPanel } from './input/DriveControlsPanel';
import { loadPlayerSettings, patchPlayerSettings, type AutoMode, type PracticeBotId, type SavedAutoPathId } from './input/player-settings';
import { useMatchGamepad } from './input/useMatchGamepad';
import { useGamepadAllianceLight } from './input/useGamepadAllianceLight';
import { syncGamepadAllianceLight, requestDs4HidDevice } from './input/gamepad-lightbar';
import type { DriveFrame } from '@ftc-sim/robot';
import { useMatchClock } from './match/useMatchClock';
import type { MatchSnapshot } from '@ftc-sim/match';
import { MatchFieldOverlay } from './match/MatchFieldOverlay';
import { MatchResultsCeremony } from './match/MatchResultsCeremony';
import { useMatchFullscreen } from './match/useMatchFullscreen';
import { useMatchAudio, playMatchAudioCue, unlockMatchAudio, emitMatchAudioCues, getMatchAudioCache } from './match/useMatchAudio';
import { PanelSection, PanelsButton, PanelsLogo } from './components/panels';
import {
  AutoProgramPanel,
  BUILTIN_AUTO_PROGRAMS,
  BUILTIN_PATHS,
  type BuiltinPathId,
  type BuiltinProgramId,
} from './components/AutoProgramPanel';
import { DevToolsDrawer } from './components/DevToolsDrawer';
import { AdvancedSettingsDrawer } from './components/AdvancedSettingsDrawer';
import { PracticeBotsPanel } from './components/PracticeBotsPanel';
import { MatchMenu } from './components/MatchMenu';
import { DebugMenu } from './components/DebugMenu';
import { installFtcSimDevApi } from './dev/inject-drive';
import { getSessionModeFromUrl, type SessionMode } from './session/session-mode';
import { buildHostRoomSettings } from './session/host-room';
import { useSessionClient } from './session/useSessionClient';
import { useOwnedRobotPrediction } from './net/useOwnedRobotPrediction';
import { LobbyScreen } from './session/LobbyScreen';
import {
  allianceForSpawnSlot,
  humanOccupiedRobotIds,
  npcSpawnSlotsForPlayer,
  playerSpawnPose,
  practiceFieldRobots,
  SOLO_SPAWN_LABELS,
  SOLO_SPAWN_SLOTS,
  type SoloSpawnSlot,
} from './robot/match-robots';
import './panels.css';

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

type LoadedPathId = SavedAutoPathId;

function initialBotSlotConfigs(
  saved: ReturnType<typeof loadPlayerSettings>,
  difficulty: Difficulty,
): BotSlotConfig[] {
  return defaultPracticeBotSlots(difficulty).map((slot) => ({
    ...slot,
    enabled: saved.practiceBotSlots[slot.robotId as PracticeBotId] ?? false,
  }));
}

function persistPracticeBotSlots(slots: BotSlotConfig[]): void {
  const practiceBotSlots: Partial<Record<PracticeBotId, boolean>> = {};
  for (const slot of slots) {
    practiceBotSlots[slot.robotId as PracticeBotId] = slot.enabled;
  }
  patchPlayerSettings({ practiceBotSlots });
}

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
  catalog: Array<{ id: string; alliance: 'blue' | 'red'; teamNumber: string }>,
  fallback: { red: [string, string]; blue: [string, string] },
): { red: [string, string]; blue: [string, string] } {
  const blue = catalog.filter((entry) => entry.alliance === 'blue').map((entry) => entry.teamNumber);
  const red = catalog.filter((entry) => entry.alliance === 'red').map((entry) => entry.teamNumber);
  return {
    blue: [blue[0] ?? fallback.blue[0], blue[1] ?? fallback.blue[1]],
    red: [red[0] ?? fallback.red[0], red[1] ?? fallback.red[1]],
  };
}

function initialOverlayTeams(
  robotTeamName: string,
  spawn: SoloSpawnSlot,
): { red: [string, string]; blue: [string, string] } {
  if (allianceForSpawnSlot(spawn) === 'blue') {
    return { red: ['-1', '-2'], blue: [robotTeamName, '-4'] };
  }
  return { red: [robotTeamName, '-2'], blue: ['-3', '-4'] };
}

export function App() {
  const field = useMemo(() => getDecodeField(), []);
  const savedPlayer = useMemo(() => loadPlayerSettings(), []);
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
      urlSession.displayName ?? savedPlayer.playerName,
      urlSession.mode === 'join' ? 'join' : 'host',
      urlSession.mode === 'host'
        ? buildHostRoomSettings(savedPlayer.robot, savedPlayer.robotPreload, savedPlayer.robotTeamName)
        : undefined,
    );
  }, [urlSession, net.connect, savedPlayer]);
  const netArtifactsRef = useRef<SimArtifactState[]>([]);
  const fieldCenterRef = useRef<HTMLElement>(null);
  const matchFullscreen = useMatchFullscreen(fieldCenterRef);
  const [barriers, setBarriers] = useState(() => initEditableBarriers(field));
  const [zones, setZones] = useState(() => initEditableZones(field));
  const [editBarriers, setEditBarriers] = useState(false);
  const [editZones, setEditZones] = useState(false);
  const [selectedVertex, setSelectedVertex] = useState<MapVertexSelection | null>(null);
  const [spawnSlot, setSpawnSlot] = useState<SoloSpawnSlot>(savedPlayer.spawnSlot);
  const alliance = allianceForSpawnSlot(spawnSlot);
  const practiceNpcSlots = useMemo(() => npcSpawnSlotsForPlayer(spawnSlot), [spawnSlot]);
  const [robotPreload, setRobotPreload] = useState(savedPlayer.robotPreload);
  const robotPreloadRef = useRef(robotPreload);
  robotPreloadRef.current = robotPreload;
  const [lobbyPlayerName, setLobbyPlayerName] = useState(savedPlayer.playerName);
  const [robotTeamName, setRobotTeamName] = useState(savedPlayer.robotTeamName);
  const initialTeams = useMemo(
    () => initialOverlayTeams(savedPlayer.robotTeamName, savedPlayer.spawnSlot),
    [savedPlayer.robotTeamName, savedPlayer.spawnSlot],
  );
  const [artifactFriction, setArtifactFriction] = useState(savedPlayer.artifactFriction);
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
  const [overlayRedTeams, setOverlayRedTeams] = useState<[string, string]>(initialTeams.red);
  const [overlayBlueTeams, setOverlayBlueTeams] = useState<[string, string]>(initialTeams.blue);
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
  const [autoMode, setAutoMode] = useState<AutoMode>(savedPlayer.autoMode);
  const [loadedProgramLabel, setLoadedProgramLabel] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<BuiltinProgramId>('duo-cycle-leave');
  const lastProgramTextRef = useRef<string | null>(savedPlayer.lastAutoProgramText);
  const [programDebug, setProgramDebug] = useState<import('@ftc-sim/pedro').AutoProgramRunnerDebug | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<BuiltinPathId>('decode-pp');
  const [loadedPathId, setLoadedPathId] = useState<LoadedPathId>(null);
  const pathChainRef = useRef<PathChain | null>(null);
  pathChainRef.current = pathChain;
  const autoSequenceRef = useRef<AutoSequence | null>(null);
  autoSequenceRef.current = autoSequence;
  const lastPathTextRef = useRef<string | null>(null);
  const [controlsDrawerOpen, setControlsDrawerOpen] = useState(false);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [driveModeLabel, setDriveModeLabel] = useState<'Robot' | 'Field'>(() =>
    savedPlayer.driveFrame === 'field' ? 'Field' : 'Robot',
  );
  const matchAudioCacheRef = useRef(getMatchAudioCache());
  const soloMatchAudioPrevRef = useRef<MatchSnapshot | null>(null);
  const autoPhasePrevRef = useRef<MatchSnapshot['phase']>('setup');
  const followerRef = useRef(new AutoProgramRunner());
  const resolvedProgramRef = useRef<ResolvedAutoProgram | null>(null);
  const resetRobotRef = useRef<(pose?: { x: number; y: number; heading: number }) => void>(() => {});
  const resetNpcPosesRef = useRef<(poses: ReadonlyMap<string, Pose>) => void>(() => {});
  const [robotConfig, setRobotConfig] = useState<SimRobotConfig>(savedPlayer.robot);
  const robotConfigRef = useRef(robotConfig);
  robotConfigRef.current = robotConfig;
  const [robotSkinId, setRobotSkinId] = useState<RobotSkinId>(savedPlayer.robotSkinId);
  const [botsEnabled, setBotsEnabled] = useState(savedPlayer.practiceBotsEnabled);
  const [botDifficulty, setBotDifficulty] = useState<Difficulty>(savedPlayer.botDifficulty);
  const [botSlotConfigs, setBotSlotConfigs] = useState<BotSlotConfig[]>(() =>
    initialBotSlotConfigs(savedPlayer, savedPlayer.botDifficulty),
  );
  const [showBotFieldDebug, setShowBotFieldDebug] = useState(savedPlayer.showBotFieldDebug);
  const botsEnabledRef = useRef(false);
  const botDifficultyRef = useRef<Difficulty>('normal');
  const botSlotConfigsRef = useRef(botSlotConfigs);
  const botManagerRef = useRef(new BotManager());
  const botPathLoadIdRef = useRef(1);
  const botAutoPathTextRef = useRef(new Map<string, string>());
  const [botSpawnOverrides, setBotSpawnOverrides] = useState<Map<BotRobotId, Pose>>(() => new Map());
  const botPathPreviewRef = useRef<BotDebugState[]>([]);
  botsEnabledRef.current = botsEnabled;
  botDifficultyRef.current = botDifficulty;
  botSlotConfigsRef.current = botSlotConfigs;

  const computeBotSpawnOverrides = useCallback((slots: BotSlotConfig[]) => {
    const overrides = new Map<BotRobotId, Pose>();
    for (const slot of slots) {
      if (!slot.enabled || !slot.runAuto || !slot.autoPath) continue;
      overrides.set(slot.robotId, botAutoStartPose(slot.autoPath, slot.robotId));
    }
    return overrides;
  }, []);

  const applyBotAutoStarts = useCallback(
    (slots: BotSlotConfig[]) => {
      if (!botsEnabledRef.current) return;
      const overrides = computeBotSpawnOverrides(slots);
      setBotSpawnOverrides(overrides);
      resetNpcPosesRef.current(overrides);
    },
    [computeBotSpawnOverrides],
  );

  const updateBotSlot = useCallback(
    (robotId: BotRobotId, patch: Partial<BotSlotConfig>) => {
      setBotSlotConfigs((prev) => {
        const next = prev.map((slot) => (slot.robotId === robotId ? { ...slot, ...patch } : slot));
        persistPracticeBotSlots(next);
        return next;
      });
    },
    [],
  );

  const applyBotAutoPath = useCallback(
    (robotId: BotRobotId, parsed: ReturnType<typeof parsePathFileText>, label: string, pathText: string) => {
      const loadId = botPathLoadIdRef.current++;
      const autoPath: BotAutoPath = {
        basePathChain: parsed.chain,
        baseAutoSequence: parsed.autoSequence ?? null,
        label,
        loadId,
      };
      setBotSlotConfigs((prev) => {
        const next = prev.map((slot) =>
          slot.robotId === robotId ? { ...slot, autoPath, runAuto: true } : slot,
        );
        persistPracticeBotSlots(next);
        if (botsEnabledRef.current) {
          const overrides = computeBotSpawnOverrides(next);
          setBotSpawnOverrides(overrides);
          queueMicrotask(() => resetNpcPosesRef.current(overrides));
        }
        return next;
      });
      botAutoPathTextRef.current.set(robotId, pathText);
    },
    [computeBotSpawnOverrides],
  );

  const loadBotAutoPathFromText = useCallback(
    (robotId: BotRobotId, text: string, label: string) => {
      if (text.length > 512 * 1024) {
        throw new Error('Path file too large (max 512 KB)');
      }
      applyBotAutoPath(robotId, parsePathFileText(text), label, text);
    },
    [applyBotAutoPath],
  );

  const loadBotBuiltinAutoPath = useCallback(
    async (robotId: BotRobotId, id: BuiltinPathId) => {
      const entry = BUILTIN_PATHS.find((path) => path.id === id);
      if (!entry) return;
      const res = await fetch(entry.file);
      if (!res.ok) throw new Error(`Failed to load ${entry.label}`);
      loadBotAutoPathFromText(robotId, await res.text(), entry.label);
    },
    [loadBotAutoPathFromText],
  );

  const clearBotAutoPath = useCallback(
    (robotId: BotRobotId) => {
      botAutoPathTextRef.current.delete(robotId);
      updateBotSlot(robotId, { autoPath: null, runAuto: false });
      setBotSpawnOverrides((prev) => {
        if (!prev.has(robotId)) return prev;
        const next = new Map(prev);
        next.delete(robotId);
        return next;
      });
    },
    [updateBotSlot],
  );

  const openAdvanced = useCallback(() => {
    setDevToolsOpen(false);
    setControlsDrawerOpen(false);
    setAdvancedOpen(true);
  }, []);

  const openDevTools = useCallback(() => {
    setAdvancedOpen(false);
    setControlsDrawerOpen(false);
    setDevToolsOpen((open) => !open);
  }, []);

  const openControlsDrawer = useCallback(() => {
    setControlsDrawerOpen(true);
  }, []);

  const practiceBotsBadge = useMemo(() => {
    if (!botsEnabled) return 'off';
    const count = botSlotConfigs.filter((slot) => slot.enabled).length;
    return `${botDifficulty} · ${count} on`;
  }, [botsEnabled, botDifficulty, botSlotConfigs]);

  const isHostSession = isNetActive && net.role === 'host';
  const showPracticeBots = !isNetSession || isHostSession;

  useEffect(() => {
    if (!isHostSession) return;
    setBotsEnabled(true);
  }, [isHostSession]);

  useEffect(() => {
    if (!isHostSession || !botsEnabled) return;
    net.sendBotSlots(netConfigFromBotSlots(botSlotConfigs, botAutoPathTextRef.current));
  }, [isHostSession, botsEnabled, botSlotConfigs, net.sendBotSlots]);

  useEffect(() => {
    if (!botsEnabled) return;
    botManagerRef.current.setSlots(botSlotConfigs);
  }, [botsEnabled, botSlotConfigs]);
  const practiceRobots = useMemo(() => {
    if (!botsEnabled) return [] as ReturnType<typeof practiceFieldRobots>;
    const enabledIds = new Set(
      botSlotConfigs.filter((slot) => slot.enabled).map((slot) => slot.robotId),
    );
    if (enabledIds.size === 0) return [] as ReturnType<typeof practiceFieldRobots>;
    const base = practiceFieldRobots(simRobotFootprint(robotConfig))
      .filter((robot) => enabledIds.has(robot.id as BotRobotId))
      .filter((robot) => isNetSession || robot.id !== spawnSlot);
    if (botSpawnOverrides.size === 0) return base;
    return base.map((robot) => {
      const override = botSpawnOverrides.get(robot.id as BotRobotId);
      return override ? { ...robot, pose: override } : robot;
    });
  }, [botsEnabled, botSlotConfigs, robotConfig, botSpawnOverrides, isNetSession, spawnSlot]);
  const practiceRobotsRef = useRef(practiceRobots);
  practiceRobotsRef.current = practiceRobots;

  const debugZones = useMemo(() => getDebugZones(field), [field]);
  const artifactSpawns = useMemo(() => getMatchArtifactStaging(), []);

  const plannedPathPoints = useMemo(() => {
    if (autoSequence) {
      return autoSequenceOverlayPoints(autoSequence, 80);
    }
    if (!pathChain) return [];
    return pathChainToPoints(pathChain, 80).map((p) => ({ x: p.x, y: p.y }));
  }, [autoSequence, pathChain]);

  const botPathPreview = useMemo(
    () => (botsEnabled ? buildBotPathPreviewStates(botSlotConfigs) : []),
    [botsEnabled, botSlotConfigs],
  );
  botPathPreviewRef.current = botPathPreview;

  useEffect(() => {
    followerRef.current.updateConstants({ mass: robotConfig.mass });
  }, [robotConfig.mass]);

  const patchRobotConfig = useCallback((patch: Partial<SimRobotConfig>) => {
    setRobotConfig((prev) => {
      const next = { ...prev, ...patch };
      patchPlayerSettings({ robot: next });
      return next;
    });
  }, []);

  const applyRobotPreset = useCallback((presetId: string) => {
    if (presetId === 'mecanum-default') {
      const next = { ...DEFAULT_SIM_ROBOT_CONFIG };
      setRobotConfig(next);
      patchPlayerSettings({ robot: next });
    }
  }, []);

  const applyRobotTeamName = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 12);
      setRobotTeamName(trimmed);
      patchPlayerSettings({ robotTeamName: trimmed });
      if (alliance === 'blue') {
        setOverlayBlueTeams(([_, second]) => [trimmed, second]);
      } else {
        setOverlayRedTeams(([_, second]) => [trimmed, second]);
      }
    },
    [alliance],
  );

  const applyLobbyPlayerName = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 32) || savedPlayer.playerName;
    setLobbyPlayerName(trimmed);
    patchPlayerSettings({ playerName: trimmed });
  }, [savedPlayer.playerName]);

  const applySpawnSlot = useCallback((slot: SoloSpawnSlot) => {
    setSpawnSlot(slot);
    patchPlayerSettings({ spawnSlot: slot });
    const slotAlliance = allianceForSpawnSlot(slot);
    setOverlayRedTeams((prev) =>
      slotAlliance === 'red' ? [robotTeamName, prev[1]] : prev,
    );
    setOverlayBlueTeams((prev) =>
      slotAlliance === 'blue' ? [robotTeamName, prev[1]] : prev,
    );
  }, [robotTeamName]);

  const fetchModuleText = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.text();
  }, []);

  const applyAutoProgram = useCallback(
    async (programText: string, label: string, source: LoadedPathId = 'upload') => {
      const resolved = await loadAutoProgramFromText(programText, fetchModuleText, alliance);
      resolvedProgramRef.current = resolved;
      setAutoMode('program');
      setLoadedProgramLabel(label);
      setLoadedPathId(null);
      setBasePathChain(null);
      setBaseAutoSequence(null);
      pathChainRef.current = null;
      autoSequenceRef.current = null;
      setPathFormat('auto-program');
      setPathWarnings([]);
      setPathError(null);
      setShowPlannedPath(true);
      lastProgramTextRef.current = programText;
      patchPlayerSettings({
        autoMode: 'program',
        lastAutoProgramText: programText,
        lastAutoProgramId: source,
        lastAutoPathText: null,
        lastAutoPathId: null,
      });
      const start = programStartPose(resolved);
      if (start) resetRobotRef.current(start);
    },
    [alliance, fetchModuleText],
  );

  const applyParsedPath = useCallback(
    (parsed: ReturnType<typeof parsePathFileText>, source: LoadedPathId = 'upload', pathText?: string) => {
      resolvedProgramRef.current = null;
      setLoadedProgramLabel(null);
      setAutoMode('simple');
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
      const textToSave = pathText ?? lastPathTextRef.current;
      if (textToSave) {
        patchPlayerSettings({
          lastAutoPathText: textToSave,
          lastAutoPathId: source ?? 'upload',
          autoMode: 'simple',
          lastAutoProgramText: null,
          lastAutoProgramId: null,
        });
      }
      if (pathText && isNetActive && net.role === 'host') {
        net.sendAutoPath(pathText);
      }
    },
    [alliance, isNetActive, net.role, net.sendAutoPath],
  );

  const clearPath = useCallback(() => {
    followerRef.current.cancelPath();
    pathChainRef.current = null;
    autoSequenceRef.current = null;
    resolvedProgramRef.current = null;
    lastPathTextRef.current = null;
    lastProgramTextRef.current = null;
    setBasePathChain(null);
    setBaseAutoSequence(null);
    setPathFormat(null);
    setPathWarnings([]);
    setPathError(null);
    setLoadedPathId(null);
    setLoadedProgramLabel(null);
    setProgramDebug(null);
    patchPlayerSettings({
      lastAutoPathText: null,
      lastAutoPathId: null,
      lastAutoProgramText: null,
      lastAutoProgramId: null,
    });
    resetRobotRef.current(playerSpawnPose(spawnSlot));
  }, [spawnSlot]);

  const startAutoPathRunner = useCallback(() => {
    followerRef.current.setPose(poseRef.current);
    const timing = robotConfigRef.current.mechanismTiming;
    followerRef.current.setWaitConfig({
      intakeFullWaitTimeoutSec: timing.intakeFullWaitTimeoutSec,
      shootEmptyWaitTimeoutSec: timing.shootEmptyWaitTimeoutSec,
      leaveSafetyMarginSec: timing.leaveSafetyMarginSec,
    });
    const resolved = resolvedProgramRef.current;
    if (resolved) {
      followerRef.current.startProgram(resolved, robotConfigRef.current.maxVelocity, timing);
      return;
    }
    const sequence = autoSequenceRef.current;
    if (sequence && sequence.steps.length > 0) {
      followerRef.current.startSimple(sequence.steps);
      return;
    }
    if (pathChainRef.current) {
      followerRef.current.followPath(pathChainRef.current);
    }
  }, []);

  const savedPathRestoredRef = useRef(false);

  const loadPathFromText = useCallback(
    (text: string, source: LoadedPathId = 'upload') => {
      if (text.length > 512 * 1024) {
        throw new Error('Path file too large (max 512 KB)');
      }
      lastPathTextRef.current = text;
      applyParsedPath(parsePathFileText(text), source, text);
    },
    [applyParsedPath],
  );

  useEffect(() => {
    if (!isNetActive || net.role !== 'host' || !lastPathTextRef.current) return;
    net.sendAutoPath(lastPathTextRef.current);
  }, [alliance, isNetActive, net.role, net.sendAutoPath]);

  const loadBuiltinProgram = useCallback(
    async (id: BuiltinProgramId) => {
      const entry = BUILTIN_AUTO_PROGRAMS.find((program) => program.id === id);
      if (!entry) return;
      try {
        const res = await fetch(entry.file);
        if (!res.ok) throw new Error(`Failed to load ${entry.label}`);
        await applyAutoProgram(await res.text(), entry.label, id);
      } catch (e) {
        setPathError(e instanceof Error ? e.message : String(e));
      }
    },
    [applyAutoProgram],
  );

  const handleProgramUpload = useCallback(
    async (file: File) => {
      setPathError(null);
      try {
        if (file.size > 256 * 1024) {
          throw new Error('Program file too large (max 256 KB)');
        }
        await applyAutoProgram(await file.text(), file.name, 'upload');
      } catch (e) {
        setPathError(e instanceof Error ? e.message : String(e));
      }
    },
    [applyAutoProgram],
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

  const startPose = useMemo(() => {
    if (autoMode === 'program' && resolvedProgramRef.current) {
      const fromProgram = programStartPose(resolvedProgramRef.current);
      if (fromProgram) return fromProgram;
    }
    if (pathChain) return getPathStartPose(pathChain);
    return playerSpawnPose(spawnSlot);
  }, [autoMode, pathChain, spawnSlot, loadedProgramLabel]);

  const effectiveStartPose = startPose;

  const [followerHud, setFollowerHud] = useState<{
    errors: { translational: number; heading: number; drive: number };
    progress: { completion: number; distanceRemaining: number };
    target: { x: number; y: number; heading: number } | null;
  } | null>(null);

  useEffect(() => {
    net.setOnAudioCue((cue) => {
      if (!matchSounds) return;
      playMatchAudioCue(cue, matchAudioCacheRef.current, matchSoundVolume);
    });
    return () => net.setOnAudioCue(null);
  }, [net.setOnAudioCue, matchSounds, matchSoundVolume]);

  const tapMatchAudio = useCallback(() => {
    if (!matchSounds) return;
    unlockMatchAudio(matchAudioCacheRef.current);
  }, [matchSounds]);

  const match = useMatchClock({ remoteAuthority: isNetActive });
  const { snapshot: matchSnap } = match;
  const displayMatchSnap = isNetActive ? (net.matchSnapshot ?? NET_SETUP_SNAPSHOT) : matchSnap;

  const playSoloMatchAudio = useCallback(
    (prevSnap: MatchSnapshot, apply: () => void) => {
      tapMatchAudio();
      apply();
      if (!matchSounds || isNetActive) return;
      const nextSnap = match.clockRef.current!.snapshot();
      emitMatchAudioCues(prevSnap, nextSnap, matchSoundVolume, matchAudioCacheRef.current);
      soloMatchAudioPrevRef.current = nextSnap;
    },
    [tapMatchAudio, matchSounds, isNetActive, matchSoundVolume, match],
  );

  useMatchAudio(displayMatchSnap, { enabled: matchSounds && !isNetActive, volume: matchSoundVolume });

  const allowsDriveRef = useRef(matchSnap.allowsDrive);
  const matchActiveRef = useRef(matchSnap.running && !matchSnap.paused);
  const getMatchSnapshotRef = useRef(() => match.clockRef.current!.snapshot());
  const getMatchStateRef = useRef<() => import('@ftc-sim/game-decode').MatchState | null>(() => null);
  allowsDriveRef.current = matchSnap.allowsDrive && !editBarriers && !editZones;
  matchActiveRef.current = matchSnap.running && !matchSnap.paused;
  getMatchSnapshotRef.current = () => match.clockRef.current!.snapshot();

  const driveBlockedRef = useRef(editBarriers || editZones);
  driveBlockedRef.current = editBarriers || editZones;

  const humanInputRobotIds = useMemo(
    () =>
      humanOccupiedRobotIds({
        spawnSlot: isNetSession ? undefined : spawnSlot,
        netRobotId: isNetActive ? net.robotId : null,
      }),
    [spawnSlot, isNetSession, isNetActive, net.robotId],
  );
  const humanInputRobotIdsRef = useRef(humanInputRobotIds);
  humanInputRobotIdsRef.current = humanInputRobotIds;

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
  const teleopDriveFrameRef = useRef<DriveFrame>(savedPlayer.driveFrame);
  const {
    samplerRef,
    sampleInput,
    updateHud,
    controlSource,
    gamepadConnected,
    driveDebug,
    setInjectInput,
    resetGamepad,
    applyKeybinds,
  } = useDriveInput(driveEnabled, listenForInput);
  useGamepadAllianceLight(alliance, gamepadConnected, displayMatchSnap.phase);

  const onHudTick = useCallback(
    (debug: NonNullable<typeof driveDebug>, source: string, connected: boolean) => {
      updateHud(debug, source as typeof controlSource, connected);
    },
    [updateHud],
  );

  const onSimHudTick = useCallback(() => {
    const clock = match.clockRef.current;
    if (!clock) return;
    const nextSnap = clock.snapshot();

    if (autoPhasePrevRef.current === 'auto' && nextSnap.phase === 'transition') {
      followerRef.current.cancelPath();
    }
    autoPhasePrevRef.current = nextSnap.phase;

    const follower = followerRef.current;
    if (follower.isRunning()) {
      const progress = follower.getProgress();
      const nextHud = {
        errors: follower.getErrors(),
        progress: {
          completion: progress.completion,
          distanceRemaining: progress.distanceRemaining,
        },
        target: follower.getTargetPose(),
      };
      setProgramDebug(follower.getRunnerDebug());
      setFollowerHud((prev) => {
        if (
          prev &&
          prev.progress.completion === nextHud.progress.completion &&
          prev.progress.distanceRemaining === nextHud.progress.distanceRemaining &&
          prev.errors.translational === nextHud.errors.translational &&
          prev.errors.heading === nextHud.errors.heading &&
          prev.errors.drive === nextHud.errors.drive &&
          prev.target?.x === nextHud.target?.x &&
          prev.target?.y === nextHud.target?.y &&
          prev.target?.heading === nextHud.target?.heading
        ) {
          return prev;
        }
        return nextHud;
      });
    } else {
      setProgramDebug((prev: import('@ftc-sim/pedro').AutoProgramRunnerDebug | null) =>
        prev === null ? prev : null,
      );
      setFollowerHud((prev) => (prev === null ? prev : null));
    }
  }, []);

  const {
    pose,
    poseRef,
    speed,
    angularSpeed,
    ready: physicsReady,
    reset: resetRobot,
    resetNpcPoses,
    physicsEvents,
    getTelemetry,
    liveArtifacts,
    liveArtifactsRef,
    matchGameState,
    mechanismDebugLogs,
    botDebugLogs,
    botDebugRef,
    setArtifactFriction: applyArtifactFriction,
    setShootHoldIntervalSec,
    randomizeMotif,
    finalizeMatch,
    advanceSimulation,
    fieldRobotsRef,
    fieldRobotCatalog,
  } = usePhysicsRobot(
    field,
    barriers,
    startPose,
    samplerRef,
    sampleInput,
    sessionMode === 'solo',
    sessionMode === 'solo',
    onHudTick,
    {
      allowsDriveRef,
      matchActiveRef,
      driveBlockedRef,
      getMatchSnapshotRef,
      followerRef,
      robotConfigRef,
      onSimHudTick: onSimHudTick,
      alliance,
      artifactStaging: artifactSpawns,
      artifactFrictionRef,
      getMatchStateRef,
      practiceRobotsRef,
      playerTeamNumber: robotTeamName,
      teleopDriveFrameRef,
      robotPreloadRef,
      botManagerRef,
      botsEnabledRef,
      botSlotConfigsRef,
      botsEnabled,
      humanInputRobotIdsRef,
    },
  );

  useEffect(() => {
    if (sessionMode !== 'solo' || !botsEnabled) return;
    resetRobot();
  }, [botsEnabled, sessionMode, resetRobot]);

  const displayMatchGameState = isNetActive ? net.gameState : matchGameState;
  getMatchStateRef.current = () => displayMatchGameState;

  const netRoomRobotConfig = useMemo(() => {
    const netRobot = net.roomConfig?.robot;
    return netRobot ? simRobotConfigFromNet(netRobot) : robotConfig;
  }, [net.roomConfig, robotConfig]);

  const ownedPoseRef = useOwnedRobotPrediction({
    enabled: isNetActive && Boolean(net.robotId),
    robotId: net.robotId,
    allowsDrive: displayMatchSnap.allowsDrive,
    robotConfig: netRoomRobotConfig,
    sampleInputRef: sampleInput,
    driveFrameRef: teleopDriveFrameRef,
    authoritativePose: isNetActive && net.pose ? net.pose : null,
    snapshotTick: net.snapshot?.tick ?? 0,
  });

  resetRobotRef.current = resetRobot;
  resetNpcPosesRef.current = resetNpcPoses;

  useEffect(() => {
    if (!botsEnabled) return;
    if (displayMatchSnap.phase !== 'setup' && displayMatchSnap.phase !== 'init') return;
    const overrides = computeBotSpawnOverrides(botSlotConfigs);
    setBotSpawnOverrides(overrides);
    resetNpcPoses(overrides);
  }, [botsEnabled, botSlotConfigs, computeBotSpawnOverrides, displayMatchSnap.phase, resetNpcPoses]);

  useEffect(() => {
    if (!physicsReady || savedPathRestoredRef.current) return;
    savedPathRestoredRef.current = true;
    if (savedPlayer.autoMode === 'program' && savedPlayer.lastAutoProgramText) {
      void applyAutoProgram(
        savedPlayer.lastAutoProgramText,
        savedPlayer.lastAutoProgramId === 'duo-cycle-leave'
          ? 'Duo cycle + leave'
          : 'Saved program',
        savedPlayer.lastAutoProgramId ?? 'upload',
      ).catch((e) => setPathError(e instanceof Error ? e.message : String(e)));
      return;
    }
    if (!savedPlayer.lastAutoPathText) return;
    try {
      loadPathFromText(savedPlayer.lastAutoPathText, savedPlayer.lastAutoPathId ?? 'upload');
    } catch (e) {
      setPathError(e instanceof Error ? e.message : String(e));
    }
  }, [
    applyAutoProgram,
    physicsReady,
    loadPathFromText,
    savedPlayer.autoMode,
    savedPlayer.lastAutoPathId,
    savedPlayer.lastAutoPathText,
    savedPlayer.lastAutoProgramId,
    savedPlayer.lastAutoProgramText,
  ]);

  useEffect(() => {
    netArtifactsRef.current = net.liveArtifacts;
  }, [net.liveArtifacts]);

  const pathLoaded = Boolean(basePathChain || baseAutoSequence || loadedProgramLabel);

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
          driveFrame: teleopDriveFrameRef.current,
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

  const displayFieldReady = isNetSession ? net.connected : physicsReady;
  const displayFieldRobotsRef = isNetActive ? net.fieldRobotsRef : fieldRobotsRef;
  const displayFieldRobotCatalog = isNetActive ? net.fieldRobotCatalog : fieldRobotCatalog;
  const displayLiveArtifacts = isNetActive ? net.liveArtifacts : liveArtifacts;
  const displayLiveArtifactsRef = isNetActive ? net.liveArtifactsRef : liveArtifactsRef;

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
    if (!basePathChain || !physicsReady || isNetSession) return;
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
  }, [alliance, baseAutoSequence, basePathChain, physicsReady, match.clockRef, isNetSession]);

  useEffect(() => {
    if (isNetSession || !physicsReady || pathChain) return;
    const snap = match.clockRef.current?.snapshot();
    const midMatch =
      snap &&
      snap.running &&
      snap.phase !== 'setup' &&
      snap.phase !== 'init' &&
      snap.phase !== 'post';
    if (midMatch) return;
    resetRobotRef.current(playerSpawnPose(spawnSlot));
  }, [spawnSlot, robotPreload, isNetSession, physicsReady, pathChain, match.clockRef]);

  useEffect(() => {
    if (!physicsReady) return;
    applyArtifactFriction(artifactFriction);
    patchPlayerSettings({ artifactFriction });
  }, [artifactFriction, physicsReady, applyArtifactFriction]);

  useEffect(() => {
    if (!physicsReady) return;
    setShootHoldIntervalSec(robotConfig.mechanismTiming.shootHoldIntervalSec);
  }, [physicsReady, robotConfig.mechanismTiming.shootHoldIntervalSec, setShootHoldIntervalSec]);

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
      getBotDebug: () => {
        const live = botDebugRef.current;
        if (live.length > 0) return live;
        return botManagerRef.current?.getDebugStates() ?? [];
      },
      getNpcPoses: () =>
        (fieldRobotsRef.current ?? [])
          .filter((robot) => robot.id !== 'player')
          .map((robot) => ({
            id: robot.id,
            pose: { ...robot.pose },
            linear: { x: 0, y: 0 },
          })),
      ensureBotsEnabled: () => {
        if (botsEnabledRef.current) return;
        botsEnabledRef.current = true;
        setBotsEnabled(true);
      },
      startInfinitePractice: () => {
        match.initMatch();
        match.startInfinitePractice();
      },
      startTimedAuto: () => {
        match.initMatch();
        match.start();
      },
      resetMatch: () => {
        match.reset();
        resetRobot(playerSpawnPose(spawnSlot));
        botManagerRef.current?.reset();
      },
      stepSimulation: (steps: number) => {
        const dt = 1 / 120;
        for (let i = 0; i < steps; i++) {
          match.tick(dt);
          advanceSimulation(1);
        }
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
    match.reset,
    match.startInfinitePractice,
    match.tick,
    matchSnap,
    poseRef,
    speed,
    loadPathJson,
    loadPathFromText,
    clearPath,
    startAutoPathRunner,
    botManagerRef,
    botDebugRef,
    advanceSimulation,
    fieldRobotsRef,
    botsEnabledRef,
    setBotsEnabled,
    spawnSlot,
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

  const copyMechanismLogs = useCallback(() => {
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
  }, [mechanismDebugLogs]);

  const copyBotLogs = useCallback(() => {
    const text = botDebugLogs.map(formatBotDebugLogEntry).join('\n');
    void navigator.clipboard.writeText(text || '(no bot logs yet)');
    setCopyStatus('Bot logs copied to clipboard');
  }, [botDebugLogs]);

  const deleteSelectedZoneVertex = useCallback(() => {
    if (selectedVertex?.layer !== 'zone') return;
    setZones((prev) =>
      deleteZoneVertex(prev, selectedVertex.zoneId, selectedVertex.vertexIndex),
    );
  }, [selectedVertex]);

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
    soloMatchAudioPrevRef.current = null;
    autoPhasePrevRef.current = 'setup';
    followerRef.current.cancelPath();
    match.reset();
    setBotSpawnOverrides(new Map());
    resetRobot(effectiveStartPose);
    setBarriers(initEditableBarriers(field));
    setZones(initEditableZones(field));
    setSelectedVertex(null);
    setFollowerHud(null);
  };

  const handleInit = () => {
    void requestDs4HidDevice().then((granted) => {
      if (granted) void syncGamepadAllianceLight(alliance);
    });
    if (isNetActive && net.role === 'host') {
      tapMatchAudio();
      applyBotAutoStarts(botSlotConfigsRef.current);
      net.sendHostCommand('init');
      return;
    }
    const prevSnap = match.clockRef.current!.snapshot();
    playSoloMatchAudio(prevSnap, () => {
      applyBotAutoStarts(botSlotConfigsRef.current);
      randomizeMotif();
      match.initMatch();
    });
  };

  const handleStartAuto = () => {
    if (isNetActive && net.role === 'host') {
      tapMatchAudio();
      net.sendHostCommand('start_auto');
      return;
    }
    const prevSnap = match.clockRef.current!.snapshot();
    playSoloMatchAudio(prevSnap, () => {
      applyBotAutoStarts(botSlotConfigsRef.current);
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
    });
  };

  const handleStartTeleop = () => {
    if (isNetActive && net.role === 'host') {
      tapMatchAudio();
      net.sendHostCommand('teleop');
      return;
    }
    const prevSnap = match.clockRef.current!.snapshot();
    playSoloMatchAudio(prevSnap, () => match.startTeleop());
  };

  const handleInfinitePractice = () => {
    if (isNetActive && net.role === 'host') {
      tapMatchAudio();
      net.sendHostCommand('infinite');
      return;
    }
    const prevSnap = match.clockRef.current!.snapshot();
    playSoloMatchAudio(prevSnap, () => match.startInfinitePractice());
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
      tapMatchAudio();
      net.sendHostCommand('end_match');
      setCeremonyTrigger((n) => n + 1);
      return;
    }
    const prevSnap = match.clockRef.current!.snapshot();
    playSoloMatchAudio(prevSnap, () => {
      finalizeMatch();
      match.endMatch();
    });
    setCeremonyTrigger((n) => n + 1);
  }, [finalizeMatch, match, isNetActive, net.role, net.sendHostCommand, tapMatchAudio, playSoloMatchAudio]);

  const phaseLabel = displayMatchSnap.infiniteMode ? 'teleop ∞' : displayMatchSnap.phase;
  const clockLabel =
    displayMatchSnap.infiniteMode && displayMatchSnap.phase === 'teleop'
      ? '∞'
      : displayMatchSnap.phase === 'auto' ||
          displayMatchSnap.phase === 'transition' ||
          displayMatchSnap.phase === 'teleop'
        ? `${displayMatchSnap.timeRemainingInPhase.toFixed(1)}s`
        : '—';

  const isNetHost = isNetActive && net.role === 'host';
  const isNetJoinPlayer = isNetActive && sessionMode === 'join';
  const isNetDriver = isNetActive && Boolean(net.robotId);
  const isNetLobby = isNetActive && !net.robotId;
  const showSidePanels = !isNetJoinPlayer;
  const showHostNavActions = !isNetActive || net.role === 'host';
  const showMatchNav = !isNetJoinPlayer || isNetLobby;
  const isNetSpectator = isNetActive && !isNetDriver && net.role !== 'host';
  const matchControlsLocked = isNetSpectator;

  const hostLatencyMs = useMemo(() => {
    if (!isNetHost) return null;
    const values = net.roomPlayers
      .map((player) => player.rttMs)
      .filter((value): value is number => value != null);
    if (values.length === 0) return net.rttMs;
    return Math.max(...values);
  }, [isNetHost, net.roomPlayers, net.rttMs]);

  let canInit = displayMatchSnap.phase === 'setup';
  let canStartAuto = displayMatchSnap.phase === 'init' && pathLoaded;
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
    canStartAuto = displayMatchSnap.phase === 'init' && pathLoaded;
    canTeleop =
      displayMatchSnap.phase === 'init' ||
      displayMatchSnap.phase === 'auto' ||
      displayMatchSnap.phase === 'transition';
    canInfinite =
      displayMatchSnap.phase !== 'post' &&
      !(displayMatchSnap.infiniteMode && displayMatchSnap.phase === 'teleop');
  }

  useMatchGamepad(
    {
      locked: matchControlsLocked,
      canInit,
      canStartAuto,
      canPause,
      onInit: handleInit,
      onStartAuto: handleStartAuto,
      onPauseToggle: handlePause,
      onReset: resetField,
    },
    true,
  );

  const displayPose = isNetActive && net.pose ? net.pose : pose;
  const headingDeg = (displayPose.heading * 180) / Math.PI;
  const coordLabel = hover
    ? `(${hover.x.toFixed(1)}, ${hover.y.toFixed(1)}) in`
    : `Robot (${displayPose.x.toFixed(1)}, ${displayPose.y.toFixed(1)}, ${headingDeg.toFixed(0)}°)`;

  const netFollowerTarget = isNetActive ? (net.netFollower?.target ?? null) : null;
  const displayFollowerTarget = netFollowerTarget ?? followerHud?.target ?? null;
  const showAutoFollowerOverlay = isNetActive
    ? Boolean(net.netFollower?.running)
    : followerHud !== null &&
      (displayMatchSnap.phase === 'auto' || displayMatchSnap.phase === 'transition');

  const showPathOnField =
    showPlannedPath &&
    plannedPathPoints.length >= 2 &&
    (displayMatchSnap.phase === 'setup' ||
      displayMatchSnap.phase === 'init' ||
      displayMatchSnap.phase === 'auto' ||
      displayMatchSnap.phase === 'transition');

  const showBotAutoPathPreview =
    botsEnabled &&
    showBotFieldDebug &&
    botPathPreview.some((entry: BotDebugState) => entry.path.length >= 2) &&
    (displayMatchSnap.phase === 'setup' ||
      displayMatchSnap.phase === 'init' ||
      displayMatchSnap.phase === 'auto' ||
      displayMatchSnap.phase === 'transition');

  return (
    <div
      className={`shell alliance-${alliance}${showMatchNav ? ' shell--match-nav' : ''}${
        matchFullscreen.immersive ? ' shell--match-fullscreen' : ''
      }`}
    >
      <LobbyScreen
        initialMode={sessionMode}
        initialAddress={urlSession.address ?? '127.0.0.1:5191'}
        initialName={lobbyPlayerName}
        initialTeamLabel={robotTeamName}
        onPlayerNameChange={applyLobbyPlayerName}
        onRobotTeamNameChange={applyRobotTeamName}
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
        versionWarning={net.versionWarning}
        onChooseSolo={() => {
          net.disconnect();
          setSessionMode('solo');
        }}
        onConnect={(mode, address, name) => {
          setSessionMode(mode);
          net.connect(
            address,
            name,
            mode === 'host' ? 'host' : 'join',
            mode === 'host'
              ? buildHostRoomSettings(
                  robotConfigRef.current,
                  robotPreloadRef.current,
                  robotTeamName,
                )
              : undefined,
          );
        }}
        onDisconnect={() => {
          net.disconnect();
          setSessionMode('solo');
        }}
        onClaimSlot={(slotId, teamLabel) => net.claimSlot(slotId, teamLabel)}
        onHostStartDriving={() => net.sendHostCommand('infinite')}
        onOpenControls={() => setControlsDrawerOpen(true)}
      />
      {controlsDrawerOpen && (
        <aside className="controls-drawer" aria-label="Drive controls">
          <div className="controls-drawer__header">
            <strong>Keyboard &amp; drive mode</strong>
            <button type="button" className="controls-drawer__close" onClick={() => setControlsDrawerOpen(false)}>
              Close
            </button>
          </div>
          <DriveControlsPanel
            variant="full"
            onSettingsChange={(settings) => {
              teleopDriveFrameRef.current = settings.driveFrame;
              setDriveModeLabel(settings.driveFrame === 'field' ? 'Field' : 'Robot');
              applyKeybinds(settings.keybinds);
            }}
          />
        </aside>
      )}
      {advancedOpen && showSidePanels && (
        <AdvancedSettingsDrawer
          onClose={() => setAdvancedOpen(false)}
          robotConfig={robotConfig}
          onRobotConfigChange={patchRobotConfig}
          onRobotPresetChange={applyRobotPreset}
          robotSkinId={robotSkinId}
          onRobotSkinIdChange={(next) => {
            setRobotSkinId(next);
            patchPlayerSettings({ robotSkinId: next });
          }}
          onPathUpload={handlePathUpload}
          onProgramUpload={handleProgramUpload}
          autoMode={autoMode}
          overlayEventName={overlayEventName}
          onOverlayEventNameChange={setOverlayEventName}
          overlayMatchName={overlayMatchName}
          onOverlayMatchNameChange={setOverlayMatchName}
          overlayRedTeams={overlayRedTeams}
          onOverlayRedTeamsChange={setOverlayRedTeams}
          overlayBlueTeams={overlayBlueTeams}
          onOverlayBlueTeamsChange={setOverlayBlueTeams}
          matchSounds={matchSounds}
          onMatchSoundsChange={setMatchSounds}
          matchSoundVolume={matchSoundVolume}
          onMatchSoundVolumeChange={setMatchSoundVolume}
        />
      )}
      {devToolsOpen && showSidePanels && (
        <DevToolsDrawer
          onClose={() => setDevToolsOpen(false)}
          artifactFriction={artifactFriction}
          onArtifactFrictionChange={setArtifactFriction}
          showZones={showZones}
          onShowZonesChange={setShowZones}
          showGateDetector={showGateDetector}
          onShowGateDetectorChange={setShowGateDetector}
          showDebugZones={showDebugZones}
          onShowDebugZonesChange={setShowDebugZones}
          showArtifacts={showArtifacts}
          onShowArtifactsChange={setShowArtifacts}
          showCenterLine={showCenterLine}
          onShowCenterLineChange={setShowCenterLine}
          showBarriers={showBarriers}
          onShowBarriersChange={setShowBarriers}
          showMatchOverlay={showMatchOverlay}
          onShowMatchOverlayChange={setShowMatchOverlay}
          editZones={editZones}
          onEditZonesChange={setEditZones}
          zones={zones}
          selectedVertex={selectedVertex}
          selectedVertexCoords={selectedVertexCoords}
          onSelectVertex={setSelectedVertex}
          onDeleteZoneVertex={deleteSelectedZoneVertex}
          onResetZones={resetZones}
          onCopyZonesJson={() => void copyZonesJson()}
          editBarriers={editBarriers}
          onEditBarriersChange={setEditBarriers}
          barriers={barriers}
          onResetBarriers={resetBarriers}
          onCopyBarriersJson={() => void copyBarriersJson()}
          copyStatus={copyStatus}
          mechanismDebugLogs={mechanismDebugLogs}
          onCopyMechanismLogs={copyMechanismLogs}
          botDebugLogs={botDebugLogs}
          onCopyBotLogs={copyBotLogs}
          driveDebug={driveDebug}
          controlSource={controlSource}
          matchPhase={matchSnap.phase}
          gamepadConnected={gamepadConnected}
          poseLabel={`(${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}, ${headingDeg.toFixed(0)}°)`}
          speed={speed}
          angularSpeed={angularSpeed}
          programDebug={programDebug}
          followerHud={
            followerHud
              ? {
                  progress: followerHud.progress,
                  errors: followerHud.errors,
                  distRemaining: followerHud.progress.distanceRemaining,
                }
              : null
          }
        />
      )}
      {showMatchNav && (
      <nav className="panels-nav" aria-label="Simulator controls">
        <div className="panels-nav__brand">
          <PanelsLogo />
          {showSidePanels && (
            <DebugMenu
              devToolsOpen={devToolsOpen}
              onToggleDevTools={openDevTools}
              showBotFieldDebug={showBotFieldDebug}
              onShowBotFieldDebugChange={(next) => {
                setShowBotFieldDebug(next);
                patchPlayerSettings({ showBotFieldDebug: next });
              }}
              showPlannedPath={showPlannedPath}
              onShowPlannedPathChange={setShowPlannedPath}
              showZones={showZones}
              onShowZonesChange={setShowZones}
              showGateDetector={showGateDetector}
              onShowGateDetectorChange={setShowGateDetector}
              showDebugZones={showDebugZones}
              onShowDebugZonesChange={setShowDebugZones}
              showArtifacts={showArtifacts}
              onShowArtifactsChange={setShowArtifacts}
              showCenterLine={showCenterLine}
              onShowCenterLineChange={setShowCenterLine}
              showBarriers={showBarriers}
              onShowBarriersChange={setShowBarriers}
              showMatchOverlay={showMatchOverlay}
              onShowMatchOverlayChange={setShowMatchOverlay}
              editZones={editZones}
              onEditZonesChange={setEditZones}
              editBarriers={editBarriers}
              onEditBarriersChange={setEditBarriers}
            />
          )}
          <span className="panels-nav__title">DECODE Sim</span>
          {isNetHost && <span className="panels-nav__net-badge panels-nav__net-badge--host">HOST</span>}
          {isNetActive && net.versionWarning && (
            <span className="panels-nav__version-warn" title={net.versionWarning}>
              Version mismatch
            </span>
          )}
          {isNetHost && hostLatencyMs != null && (
            <span
              className={`panels-nav__net-badge panels-nav__net-badge--latency${
                hostLatencyMs > 120 ? ' panels-nav__net-badge--latency-high' : ''
              }`}
              title="Highest player round-trip latency"
            >
              {hostLatencyMs} ms
            </span>
          )}
          {isNetLobby && net.role === 'host' && (
            <span className="panels-nav__net-badge panels-nav__net-badge--driver">LOBBY</span>
          )}
          {isNetDriver && !isNetHost && (
            <span className="panels-nav__net-badge panels-nav__net-badge--driver">DRIVER</span>
          )}
          {isNetLobby && net.role !== 'host' && (
            <span className="panels-nav__net-badge panels-nav__net-badge--driver">PICK ROBOT</span>
          )}
          {isNetDriver && !isNetHost && (
            <span className="panels-nav__net-badge panels-nav__net-badge--drive-mode">{driveModeLabel}</span>
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
          <PanelsButton
            variant={matchFullscreen.isActive ? 'primary' : 'default'}
            onClick={() => void matchFullscreen.toggle()}
            title="Fullscreen match view (F11). Press Esc to exit."
          >
            {matchFullscreen.isActive ? 'Exit fullscreen' : 'Fullscreen'}
          </PanelsButton>
          {(isNetJoinPlayer || isNetHost) && !isNetSpectator && (
            <PanelsButton
              variant={controlsDrawerOpen ? 'primary' : 'default'}
              onClick={() => setControlsDrawerOpen((open) => !open)}
            >
              Controls
            </PanelsButton>
          )}
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
          <MatchMenu
            disabled={matchControlsLocked}
            canInfinite={canInfinite}
            canPause={canPause}
            canEndMatch={canEndMatch}
            paused={displayMatchSnap.paused}
            onInfinite={handleInfinitePractice}
            onPause={handlePause}
            onEndMatch={handleEndMatch}
            onReset={resetField}
          />
            </>
          )}
        </div>
      </nav>
      )}

      <div className={`panels-body${isNetJoinPlayer ? ' panels-body--join' : ''}`}>
        {showSidePanels && (
        <div className="panels-column">
          <PanelSection
            title="Setup"
            badge={`${alliance === 'blue' ? 'Blue' : 'Red'} · ${robotTeamName}`}
          >
            {isNetSession ? (
              <p className="hint">
                Spawn is set when you claim a slot in the lobby. Paths mirror for your alliance.
              </p>
            ) : (
              <>
                <p className="hint">Pick a launch corner, then INIT.</p>
                <div className="spawn-grid">
                  {SOLO_SPAWN_SLOTS.map((slot) => (
                    <PanelsButton
                      key={slot}
                      variant={spawnSlot === slot ? 'primary' : 'default'}
                      disabled={Boolean(pathChain) || displayMatchSnap.phase === 'post'}
                      onClick={() => applySpawnSlot(slot)}
                    >
                      {SOLO_SPAWN_LABELS[slot]}
                    </PanelsButton>
                  ))}
                </div>
                {pathChain ? (
                  <p className="hint">Clear auto path to change spawn.</p>
                ) : null}
              </>
            )}
            <div className="setup-fields-row">
              <label className="panel-field">
                Your name
                <input
                  className="panel-select"
                  type="text"
                  value={lobbyPlayerName}
                  maxLength={32}
                  onChange={(e) => applyLobbyPlayerName(e.target.value)}
                />
              </label>
              <label className="panel-field">
                Team #
                <input
                  className="panel-select"
                  type="text"
                  value={robotTeamName}
                  maxLength={12}
                  onChange={(e) => applyRobotTeamName(e.target.value)}
                />
              </label>
            </div>
            <label className="panel-check">
              <input
                type="checkbox"
                checked={robotPreload}
                onChange={(e) => {
                  setRobotPreload(e.target.checked);
                  patchPlayerSettings({ robotPreload: e.target.checked });
                }}
              />
              Preload 2 purple + 1 green
            </label>
          </PanelSection>

          <PanelSection
            key={pathChain || loadedProgramLabel ? 'auto-loaded' : 'auto-empty'}
            title="Autonomous"
            badge={
              loadedProgramLabel
                ? loadedProgramLabel
                : pathChain
                  ? loadedPathId === 'upload'
                    ? 'Custom upload'
                    : BUILTIN_PATHS.find((path) => path.id === loadedPathId)?.label ??
                      `${pathChain.paths.length} seg`
                  : 'none'
            }
            defaultOpen={!!pathChain || !!loadedProgramLabel}
          >
            <AutoProgramPanel
              autoMode={autoMode}
              onAutoModeChange={(mode) => {
                setAutoMode(mode);
                patchPlayerSettings({ autoMode: mode });
              }}
              selectedPathId={selectedPathId}
              onSelectedPathIdChange={setSelectedPathId}
              selectedProgramId={selectedProgramId}
              onSelectedProgramIdChange={setSelectedProgramId}
              loadedPathId={loadedPathId}
              loadedProgramLabel={loadedProgramLabel}
              pathFormat={pathFormat}
              pathError={pathError}
              pathWarnings={pathWarnings}
              showPlannedPath={showPlannedPath}
              onShowPlannedPathChange={setShowPlannedPath}
              onLoadBuiltinPath={(id) => void loadBuiltinPath(id)}
              onLoadBuiltinProgram={(id) => void loadBuiltinProgram(id)}
              onClear={clearPath}
              onOpenAdvanced={openAdvanced}
            />
          </PanelSection>

          <PanelSection title="Teleop" badge={driveModeLabel}>
            <DriveControlsPanel
              variant="compact"
              onOpenFullControls={openControlsDrawer}
              onSettingsChange={(settings) => {
                teleopDriveFrameRef.current = settings.driveFrame;
                setDriveModeLabel(settings.driveFrame === 'field' ? 'Field' : 'Robot');
                applyKeybinds(settings.keybinds);
              }}
            />
            {(editBarriers || editZones) && (
              <p className="hint">Turn off map editing to drive.</p>
            )}
          </PanelSection>

          {showPracticeBots && (
            <PanelSection title="Practice bots" badge={practiceBotsBadge} defaultOpen={false}>
              <PracticeBotsPanel
                botsEnabled={botsEnabled}
                onBotsEnabledChange={setBotsEnabled}
                botDifficulty={botDifficulty}
                onBotDifficultyChange={(difficulty) => {
                  setBotDifficulty(difficulty);
                  patchPlayerSettings({ botDifficulty: difficulty });
                  setBotSlotConfigs((prev) => prev.map((slot) => ({ ...slot, difficulty })));
                }}
                practiceNpcSlots={practiceNpcSlots}
                botSlotConfigs={botSlotConfigs}
                humanInputRobotIds={humanInputRobotIds}
                isHostSession={isHostSession}
                onUpdateBotSlot={updateBotSlot}
                onLoadBuiltinPath={loadBotBuiltinAutoPath}
                onLoadPathFromFile={loadBotAutoPathFromText}
                onClearPath={clearBotAutoPath}
              />
            </PanelSection>
          )}

          <div className="panels-column__footer">
            <PanelsButton className="panels-column__advanced-btn" onClick={openAdvanced}>
              Advanced settings
            </PanelsButton>
          </div>
        </div>
        )}

        <main
          ref={fieldCenterRef}
          className={`panel-center${matchFullscreen.isActive ? ' panel-center--fullscreen' : ''}`}
          aria-label="Field view"
          tabIndex={0}
          onPointerDown={() => fieldCenterRef.current?.focus()}
          onDoubleClick={() => void matchFullscreen.toggle()}
        >
          {matchFullscreen.isActive ? (
            <div className="match-fullscreen-exit-hint" aria-hidden>
              Esc to exit fullscreen
            </div>
          ) : (
            <button
              type="button"
              className="match-fullscreen-toggle"
              onClick={(event) => {
                event.stopPropagation();
                void matchFullscreen.enter();
              }}
              title="Fullscreen match + overlay (F11 or PS4 touchpad). Press Esc to exit."
              aria-label="Fullscreen match view"
            >
              ⛶
            </button>
          )}
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
              plannedPathAlliance={alliance}
              showPlannedPath={showPathOnField}
              followerTarget={displayFollowerTarget}
              showFollowerOverlay={showAutoFollowerOverlay}
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
              netRobotMotionRef={net.netRobotMotionRef}
              netSnapshotAtRef={net.lastSnapshotAtRef}
              ownedRobotId={isNetActive ? net.robotId : null}
              ownedPoseRef={ownedPoseRef}
              showBotDebug={!isNetSession && botsEnabled && showBotFieldDebug}
              botDebugRef={!isNetSession && botsEnabled ? botDebugRef : undefined}
              botAutoPathPreviewRef={
                !isNetSession && showBotAutoPathPreview ? botPathPreviewRef : undefined
              }
              robotSkinId={robotSkinId}
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
            fieldRobotCatalog={displayFieldRobotCatalog}
          />
        </main>
      </div>

      {showSidePanels && (
      <footer className="panels-footer">
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
