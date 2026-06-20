import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface PlayerSettings {
  lastJoinAddress?: string;
}

const SETTINGS_FILE = 'player-settings.json';

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export function readPlayerSettings(): PlayerSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return JSON.parse(raw) as PlayerSettings;
  } catch {
    return {};
  }
}

export function writePlayerSettings(settings: PlayerSettings): PlayerSettings {
  const dir = path.dirname(settingsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}
