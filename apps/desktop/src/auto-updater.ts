import { app, BrowserWindow, dialog, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { request } from 'node:https';
import { autoUpdater } from 'electron-updater';

const RELEASE_PAGE = 'https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest';
const REPO = 'Pleasantnoob/VibeCodedFTCSIM';

let pendingUpdateVersion: string | null = null;

function downloadsDir(): string {
  return app.getPath('downloads');
}

function zipUrl(version: string): string {
  return `https://github.com/${REPO}/releases/download/v${version}/FTC-Sim-win-x64.zip`;
}

function zipDest(version: string): string {
  return join(downloadsDir(), `FTC-Sim-win-x64-v${version}.zip`);
}

async function downloadZip(
  version: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  const dest = zipDest(version);
  await mkdir(downloadsDir(), { recursive: true });

  return new Promise((resolve, reject) => {
    const url = zipUrl(version);
    request(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        request(response.headers.location, (redirect) => {
          void pipeResponse(redirect, dest, onProgress).then(resolve).catch(reject);
        }).on('error', reject);
        return;
      }
      void pipeResponse(response, dest, onProgress).then(resolve).catch(reject);
    }).on('error', reject);
  });
}

async function pipeResponse(
  response: NodeJS.ReadableStream & { statusCode?: number; headers: { 'content-length'?: string } },
  dest: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  if (response.statusCode && response.statusCode >= 400) {
    throw new Error(`Download failed (HTTP ${response.statusCode})`);
  }
  const total = Number(response.headers['content-length'] ?? 0);
  let received = 0;
  response.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total > 0) {
      onProgress(Math.min(100, Math.round((received / total) * 100)));
    }
  });
  await pipeline(response, createWriteStream(dest));
  onProgress(100);
  return dest;
}

/** Check GitHub Releases (latest.yml) and download zip with progress when user accepts. */
export function setupAutoUpdater(getLauncherWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `https://github.com/${REPO}/releases/latest/download`,
  });

  autoUpdater.on('update-available', (info) => {
    pendingUpdateVersion = info.version;
    const launcher = getLauncherWindow();
    launcher?.webContents.send('launcher:update-available', {
      version: info.version,
      current: app.getVersion(),
    });

    const dialogOptions = {
      type: 'info' as const,
      title: 'Update available',
      message: `FTC Sim ${info.version} is available.`,
      detail: `You have ${app.getVersion()}. Download the zip and extract with WinRAR or 7-Zip, then replace your FTC Sim folder.`,
      buttons: ['Download update', 'Later'],
      defaultId: 0,
    };
    void (launcher
      ? dialog.showMessageBox(launcher, dialogOptions)
      : dialog.showMessageBox(dialogOptions)
    ).then(({ response }) => {
      if (response === 0) {
        void startDownload(info.version, getLauncherWindow);
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    pendingUpdateVersion = null;
    getLauncherWindow()?.webContents.send('launcher:update-available', null);
  });

  autoUpdater.on('error', (error) => {
    console.warn('[auto-updater]', error.message);
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: Error) => {
      console.warn('[auto-updater] check failed:', error.message);
    });
  }, 4000);

  const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((error: Error) => {
      console.warn('[auto-updater] periodic check failed:', error.message);
    });
  }, CHECK_INTERVAL_MS);
}

export async function startDownload(
  version: string,
  getLauncherWindow: () => BrowserWindow | null,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const launcher = getLauncherWindow();
  try {
    launcher?.webContents.send('launcher:update-progress', { version, percent: 0 });
    const path = await downloadZip(version, (percent) => {
      launcher?.webContents.send('launcher:update-progress', { version, percent });
    });
    const { response } = launcher
      ? await dialog.showMessageBox(launcher, {
          type: 'info',
          title: 'Update downloaded',
          message: 'Download complete',
          detail: `Saved to ${path}\n\nExtract with WinRAR or 7-Zip and replace your FTC Sim folder.`,
          buttons: ['Open Downloads', 'OK'],
          defaultId: 0,
        })
      : await dialog.showMessageBox({
          type: 'info',
          title: 'Update downloaded',
          message: 'Download complete',
          detail: `Saved to ${path}\n\nExtract with WinRAR or 7-Zip and replace your FTC Sim folder.`,
          buttons: ['Open Downloads', 'OK'],
          defaultId: 0,
        });
    if (response === 0) {
      void shell.openPath(downloadsDir());
    }
    return { ok: true, path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[auto-updater] download failed:', message);
    await (launcher
      ? dialog.showMessageBox(launcher, {
          type: 'error',
          title: 'Download failed',
          message: 'Could not download the update zip.',
          detail: `${message}\n\nYou can download manually from GitHub Releases.`,
          buttons: ['Open releases page', 'OK'],
        })
      : dialog.showMessageBox({
          type: 'error',
          title: 'Download failed',
          message: 'Could not download the update zip.',
          detail: `${message}\n\nYou can download manually from GitHub Releases.`,
          buttons: ['Open releases page', 'OK'],
        })
    ).then(({ response }) => {
      if (response === 0) void shell.openExternal(RELEASE_PAGE);
    });
    return { ok: false, error: message };
  }
}

export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}

export { RELEASE_PAGE };
