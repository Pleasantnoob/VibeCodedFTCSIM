import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const UI_PORT = 5190;
export const MATCH_PORT = 5191;

function desktopResourcesRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(app.getAppPath(), 'resources');
}

export function webRoot(): string {
  const bundled = path.join(desktopResourcesRoot(), 'web');
  if (fs.existsSync(path.join(bundled, 'index.html'))) {
    return bundled;
  }
  return path.resolve(app.getAppPath(), '..', 'web', 'dist');
}

export function launcherHtmlPath(): string {
  return path.join(app.getAppPath(), 'launcher.html');
}
