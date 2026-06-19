import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface HostSettings {
  internetAddress: string;
}

const DEFAULT: HostSettings = { internetAddress: '' };

function settingsPath(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'host-settings.json');
  }
  return path.join(os.homedir(), '.ftc-sim', 'host-settings.json');
}

export function readHostSettings(): HostSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<{ internetAddress?: string; playitAddress?: string }>;
    const internetAddress = (parsed.internetAddress ?? parsed.playitAddress ?? '').trim();
    return { internetAddress };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeHostSettings(settings: HostSettings): HostSettings {
  const next = { internetAddress: settings.internetAddress.trim() };
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}
