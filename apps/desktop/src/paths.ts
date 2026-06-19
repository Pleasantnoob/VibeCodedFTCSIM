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

export function matchServerEntry(): string {
  const bundled = path.join(desktopResourcesRoot(), 'match-server', 'dist', 'index.js');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return path.resolve(app.getAppPath(), '..', 'match-server', 'dist', 'index.js');
}

export function matchServerCwd(): string {
  const bundled = path.join(desktopResourcesRoot(), 'match-server');
  if (fs.existsSync(path.join(bundled, 'dist', 'index.js'))) {
    return bundled;
  }
  return path.resolve(app.getAppPath(), '..', 'match-server');
}

export function launcherHtmlPath(): string {
  return path.join(app.getAppPath(), 'launcher.html');
}
