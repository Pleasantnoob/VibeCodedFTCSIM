import type { DriveFrame } from '@ftc-sim/robot';
import type { SoloSpawnSlot } from '../robot/match-robots';
import {
  DEFAULT_MECHANISM_TIMING,
  DEFAULT_SIM_ROBOT_CONFIG,
  type MechanismTimingConfig,
  type PerformancePresetId,
  type SimRobotConfig,
} from '../robot/robot-config';
import { DEFAULT_ROBOT_SKIN_ID, parseRobotSkinId, type RobotSkinId } from '../robot/robot-skins';
import { DEFAULT_DRIVE_KEYBINDS, type DriveKeybinds } from './drive-keybind-defaults';

import type { BotRobotId, Difficulty } from '@ftc-sim/bot';

export type SavedAutoPathId =
  | 'decode-pp'
  | 'decode-json'
  | 'really-good'
  | 'super-duo-far12'
  | 'super-duo-near12'
  | 'simple-duo-far'
  | 'super-simple-far'
  | 'duo-cycle-leave'
  | 'upload'
  | null;

export type AutoMode = 'simple' | 'program';

export interface PlayerSettings {
  playerName: string;
  robotTeamName: string;
  driveFrame: DriveFrame;
  keybinds: DriveKeybinds;
  robot: SimRobotConfig;
  robotPreload: boolean;
  robotSkinId: RobotSkinId;
  spawnSlot: SoloSpawnSlot;
  autoMode: AutoMode;
  lastAutoPathText: string | null;
  lastAutoPathId: SavedAutoPathId;
  lastAutoProgramText: string | null;
  lastAutoProgramId: SavedAutoPathId;
  practiceBotsEnabled: boolean;
  practiceBotSlots: Partial<Record<PracticeBotId, boolean>>;
  botDifficulty: Difficulty;
  artifactFriction: number;
  showBotFieldDebug: boolean;
}

export type PracticeBotId = Extract<BotRobotId, 'blue-near' | 'red-far' | 'red-near'>;

const STORAGE_KEY = 'ftc-sim.player-settings.v2';
const LEGACY_STORAGE_KEY = 'ftc-sim.player-settings.v1';
const LEGACY_DRIVE_KEY = 'ftc-sim.drive-settings.v1';
const LEGACY_KEYBINDS_KEY = 'ftc-sim.drive-keybinds.v1';

const SOLO_SPAWN_VALUES: SoloSpawnSlot[] = ['blue-near', 'blue-far', 'red-near', 'red-far'];

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  playerName: 'Driver',
  robotTeamName: '-4',
  driveFrame: 'field',
  keybinds: { ...DEFAULT_DRIVE_KEYBINDS },
  robot: { ...DEFAULT_SIM_ROBOT_CONFIG },
  robotPreload: true,
  robotSkinId: DEFAULT_ROBOT_SKIN_ID,
  spawnSlot: 'blue-far',
  autoMode: 'simple',
  lastAutoPathText: null,
  lastAutoPathId: null,
  lastAutoProgramText: null,
  lastAutoProgramId: null,
  practiceBotsEnabled: false,
  practiceBotSlots: {},
  botDifficulty: 'normal',
  artifactFriction: 0.25,
  showBotFieldDebug: true,
};

function clampMechanismTiming(raw: Partial<MechanismTimingConfig> | undefined): MechanismTimingConfig {
  const base = { ...DEFAULT_MECHANISM_TIMING, ...raw };
  return {
    shootHoldIntervalSec: clampNum(base.shootHoldIntervalSec, 0.05, 0.5, DEFAULT_MECHANISM_TIMING.shootHoldIntervalSec),
    intakeFullWaitTimeoutSec: clampNum(base.intakeFullWaitTimeoutSec, 0.5, 8, DEFAULT_MECHANISM_TIMING.intakeFullWaitTimeoutSec),
    shootEmptyWaitTimeoutSec: clampNum(base.shootEmptyWaitTimeoutSec, 1, 10, DEFAULT_MECHANISM_TIMING.shootEmptyWaitTimeoutSec),
    leaveSafetyMarginSec: clampNum(base.leaveSafetyMarginSec, 0.5, 6, DEFAULT_MECHANISM_TIMING.leaveSafetyMarginSec),
  };
}

function clampRobotConfig(raw: Partial<SimRobotConfig> | undefined): SimRobotConfig {
  const base = { ...DEFAULT_SIM_ROBOT_CONFIG, ...raw };
  const migrated = migrateLegacyTurnSpeed(base);
  const performancePreset: PerformancePresetId =
    migrated.performancePreset === 'competitive' || migrated.performancePreset === 'custom'
      ? migrated.performancePreset
      : 'stock';
  return {
    presetId: migrated.presetId || DEFAULT_SIM_ROBOT_CONFIG.presetId,
    performancePreset,
    maxVelocity: clampNum(migrated.maxVelocity, 10, 80, DEFAULT_SIM_ROBOT_CONFIG.maxVelocity),
    maxAngularVelocity: clampNum(
      migrated.maxAngularVelocity,
      1,
      8,
      DEFAULT_SIM_ROBOT_CONFIG.maxAngularVelocity,
    ),
    maxAcceleration: clampNum(
      migrated.maxAcceleration,
      12,
      120,
      DEFAULT_SIM_ROBOT_CONFIG.maxAcceleration,
    ),
    maxAngularAcceleration: clampNum(
      migrated.maxAngularAcceleration,
      6,
      36,
      DEFAULT_SIM_ROBOT_CONFIG.maxAngularAcceleration,
    ),
    mass: clampNum(migrated.mass, 5, 40, DEFAULT_SIM_ROBOT_CONFIG.mass),
    footprintWidth: clampNum(migrated.footprintWidth, 10, 18, DEFAULT_SIM_ROBOT_CONFIG.footprintWidth),
    footprintLength: clampNum(migrated.footprintLength, 10, 18, DEFAULT_SIM_ROBOT_CONFIG.footprintLength),
    mechanismTiming: clampMechanismTiming(migrated.mechanismTiming),
  };
}

/** Bump pre-2025 turn defaults so saved settings match faster bot-like rotation. */
function migrateLegacyTurnSpeed(config: SimRobotConfig): SimRobotConfig {
  let { maxAngularVelocity, maxAngularAcceleration } = config;
  if (maxAngularVelocity === 4) maxAngularVelocity = DEFAULT_SIM_ROBOT_CONFIG.maxAngularVelocity;
  if (maxAngularAcceleration === 18) {
    maxAngularAcceleration = DEFAULT_SIM_ROBOT_CONFIG.maxAngularAcceleration;
  }
  return { ...config, maxAngularVelocity, maxAngularAcceleration };
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseSpawnSlot(value: unknown): SoloSpawnSlot {
  if (typeof value === 'string' && SOLO_SPAWN_VALUES.includes(value as SoloSpawnSlot)) {
    return value as SoloSpawnSlot;
  }
  return DEFAULT_PLAYER_SETTINGS.spawnSlot;
}

function parseSavedAutoPathId(value: unknown): SavedAutoPathId {
  const allowed: SavedAutoPathId[] = [
    'decode-pp',
    'decode-json',
    'really-good',
    'super-duo-far12',
    'super-duo-near12',
    'simple-duo-far',
    'super-simple-far',
    'duo-cycle-leave',
    'upload',
    null,
  ];
  if (value === null) return null;
  return allowed.includes(value as SavedAutoPathId) ? (value as SavedAutoPathId) : null;
}

function parsePracticeBotSlots(
  raw: Partial<Record<PracticeBotId, boolean>> | undefined,
): Partial<Record<PracticeBotId, boolean>> {
  if (!raw || typeof raw !== 'object') return {};
  const next: Partial<Record<PracticeBotId, boolean>> = {};
  for (const id of ['blue-near', 'red-far', 'red-near'] as const) {
    if (typeof raw[id] === 'boolean') next[id] = raw[id];
  }
  return next;
}

function readStoredSettingsRaw(): Partial<PlayerSettings> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Partial<PlayerSettings>;
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return JSON.parse(legacy) as Partial<PlayerSettings>;
    return null;
  } catch {
    return null;
  }
}

function normalizeSettings(parsed: Partial<PlayerSettings>): PlayerSettings {
  return {
    playerName:
      typeof parsed.playerName === 'string' && parsed.playerName.trim()
        ? parsed.playerName.trim().slice(0, 32)
        : DEFAULT_PLAYER_SETTINGS.playerName,
    robotTeamName:
      typeof parsed.robotTeamName === 'string' && parsed.robotTeamName.trim()
        ? parsed.robotTeamName.trim().slice(0, 12)
        : DEFAULT_PLAYER_SETTINGS.robotTeamName,
    driveFrame: parsed.driveFrame === 'robot' ? 'robot' : 'field',
    keybinds: mergeKeybinds(parsed.keybinds),
    robot: clampRobotConfig(parsed.robot),
    robotPreload: parsed.robotPreload !== false,
    robotSkinId: parseRobotSkinId(parsed.robotSkinId),
    spawnSlot: parseSpawnSlot(parsed.spawnSlot),
    autoMode: parsed.autoMode === 'program' ? 'program' : 'simple',
    lastAutoPathText:
      typeof parsed.lastAutoPathText === 'string' && parsed.lastAutoPathText.length > 0
        ? parsed.lastAutoPathText
        : null,
    lastAutoPathId: parseSavedAutoPathId(parsed.lastAutoPathId ?? null),
    lastAutoProgramText:
      typeof parsed.lastAutoProgramText === 'string' && parsed.lastAutoProgramText.length > 0
        ? parsed.lastAutoProgramText
        : null,
    lastAutoProgramId: parseSavedAutoPathId(parsed.lastAutoProgramId ?? null),
    practiceBotsEnabled: parsed.practiceBotsEnabled === true,
    practiceBotSlots: parsePracticeBotSlots(parsed.practiceBotSlots),
    botDifficulty:
      parsed.botDifficulty === 'easy' || parsed.botDifficulty === 'hard'
        ? parsed.botDifficulty
        : 'normal',
    artifactFriction: clampNum(parsed.artifactFriction, 0.1, 1.5, DEFAULT_PLAYER_SETTINGS.artifactFriction),
    showBotFieldDebug: parsed.showBotFieldDebug !== false,
  };
}

function mergeKeybinds(raw: Partial<DriveKeybinds> | undefined): DriveKeybinds {
  return { ...DEFAULT_DRIVE_KEYBINDS, ...raw };
}

function readLegacyDriveFrame(): DriveFrame | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LEGACY_DRIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { driveFrame?: unknown };
    return parsed.driveFrame === 'robot' ? 'robot' : 'field';
  } catch {
    return null;
  }
}

function readLegacyKeybinds(): DriveKeybinds | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LEGACY_KEYBINDS_KEY);
    if (!raw) return null;
    return mergeKeybinds(JSON.parse(raw) as Partial<DriveKeybinds>);
  } catch {
    return null;
  }
}

function migrateLegacySettings(): PlayerSettings | null {
  if (typeof localStorage === 'undefined') return null;
  const hadLegacy = localStorage.getItem(LEGACY_DRIVE_KEY) || localStorage.getItem(LEGACY_KEYBINDS_KEY);
  if (!hadLegacy) return null;

  const legacyDriveFrame = readLegacyDriveFrame();
  const legacyKeybinds = readLegacyKeybinds();
  return {
    ...DEFAULT_PLAYER_SETTINGS,
    driveFrame: legacyDriveFrame ?? DEFAULT_PLAYER_SETTINGS.driveFrame,
    keybinds: legacyKeybinds ?? { ...DEFAULT_DRIVE_KEYBINDS },
  };
}

export function loadPlayerSettings(): PlayerSettings {
  if (typeof localStorage === 'undefined') {
    return {
      ...DEFAULT_PLAYER_SETTINGS,
      keybinds: { ...DEFAULT_DRIVE_KEYBINDS },
      robot: { ...DEFAULT_SIM_ROBOT_CONFIG },
    };
  }

  try {
    const stored = readStoredSettingsRaw();
    if (!stored) {
      const migrated = migrateLegacySettings();
      if (migrated) {
        savePlayerSettings(migrated);
        return migrated;
      }
      return {
        ...DEFAULT_PLAYER_SETTINGS,
        keybinds: { ...DEFAULT_DRIVE_KEYBINDS },
        robot: { ...DEFAULT_SIM_ROBOT_CONFIG },
      };
    }

    return normalizeSettings(stored);
  } catch {
    return {
      ...DEFAULT_PLAYER_SETTINGS,
      keybinds: { ...DEFAULT_DRIVE_KEYBINDS },
      robot: { ...DEFAULT_SIM_ROBOT_CONFIG },
    };
  }
}

export function savePlayerSettings(settings: PlayerSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function patchPlayerSettings(patch: Partial<PlayerSettings>): PlayerSettings {
  const current = loadPlayerSettings();
  const next: PlayerSettings = {
    ...current,
    ...patch,
    keybinds: patch.keybinds ? mergeKeybinds({ ...current.keybinds, ...patch.keybinds }) : current.keybinds,
    robot: patch.robot ? clampRobotConfig({ ...current.robot, ...patch.robot }) : current.robot,
  };
  if (patch.playerName !== undefined) {
    next.playerName = patch.playerName.trim().slice(0, 32) || DEFAULT_PLAYER_SETTINGS.playerName;
  }
  if (patch.robotTeamName !== undefined) {
    next.robotTeamName = patch.robotTeamName.trim().slice(0, 12) || DEFAULT_PLAYER_SETTINGS.robotTeamName;
  }
  if (patch.spawnSlot !== undefined) {
    next.spawnSlot = parseSpawnSlot(patch.spawnSlot);
  }
  if (patch.robotSkinId !== undefined) {
    next.robotSkinId = parseRobotSkinId(patch.robotSkinId);
  }
  if (patch.lastAutoPathId !== undefined) {
    next.lastAutoPathId = parseSavedAutoPathId(patch.lastAutoPathId);
  }
  if (patch.practiceBotSlots !== undefined) {
    next.practiceBotSlots = parsePracticeBotSlots({
      ...current.practiceBotSlots,
      ...patch.practiceBotSlots,
    });
  }
  savePlayerSettings(next);
  return next;
}
