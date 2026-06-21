import type { DriveFrame } from '@ftc-sim/robot';
import type { SoloSpawnSlot } from '../robot/match-robots';
import { DEFAULT_SIM_ROBOT_CONFIG, type SimRobotConfig } from '../robot/robot-config';
import { DEFAULT_ROBOT_SKIN_ID, parseRobotSkinId, type RobotSkinId } from '../robot/robot-skins';
import { DEFAULT_DRIVE_KEYBINDS, type DriveKeybinds } from './drive-keybind-defaults';

export interface PlayerSettings {
  playerName: string;
  robotTeamName: string;
  driveFrame: DriveFrame;
  keybinds: DriveKeybinds;
  robot: SimRobotConfig;
  robotPreload: boolean;
  robotSkinId: RobotSkinId;
  spawnSlot: SoloSpawnSlot;
}

const STORAGE_KEY = 'ftc-sim.player-settings.v1';
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
};

function clampRobotConfig(raw: Partial<SimRobotConfig> | undefined): SimRobotConfig {
  const base = { ...DEFAULT_SIM_ROBOT_CONFIG, ...raw };
  return {
    presetId: base.presetId || DEFAULT_SIM_ROBOT_CONFIG.presetId,
    maxVelocity: clampNum(base.maxVelocity, 10, 80, DEFAULT_SIM_ROBOT_CONFIG.maxVelocity),
    maxAngularVelocity: clampNum(
      base.maxAngularVelocity,
      1,
      8,
      DEFAULT_SIM_ROBOT_CONFIG.maxAngularVelocity,
    ),
    maxAcceleration: clampNum(base.maxAcceleration, 12, 120, DEFAULT_SIM_ROBOT_CONFIG.maxAcceleration),
    maxAngularAcceleration: clampNum(
      base.maxAngularAcceleration,
      6,
      36,
      DEFAULT_SIM_ROBOT_CONFIG.maxAngularAcceleration,
    ),
    mass: clampNum(base.mass, 5, 40, DEFAULT_SIM_ROBOT_CONFIG.mass),
    footprintWidth: clampNum(base.footprintWidth, 10, 18, DEFAULT_SIM_ROBOT_CONFIG.footprintWidth),
    footprintLength: clampNum(base.footprintLength, 10, 18, DEFAULT_SIM_ROBOT_CONFIG.footprintLength),
  };
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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
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

    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
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
    };
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
  savePlayerSettings(next);
  return next;
}
