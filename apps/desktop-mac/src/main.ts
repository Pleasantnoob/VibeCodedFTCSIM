import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { Server } from 'node:http';
import path from 'node:path';
import { launcherHtmlPath, UI_PORT, webRoot } from './paths';
import { resolveJoinAddress } from './join-address';
import { readPlayerSettings, writePlayerSettings } from './player-settings';
import { startStaticServer } from './static-server';
import { setupAutoUpdater, startDownload, getPendingUpdateVersion, RELEASE_PAGE } from './auto-updater';

const JOIN_HELP_DOC =
  'https://github.com/Pleasantnoob/VibeCodedFTCSIM/blob/main/docs/DESKTOP_MAC.md';

let uiServer: Server | null = null;
let launcherWindow: BrowserWindow | null = null;
const gameWindows = new Set<BrowserWindow>();

const gameWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  backgroundThrottling: false,
} as const;

function gameUrl(joinAddress: string, name = 'Driver'): string {
  const addr = resolveJoinAddress(joinAddress);
  const params = new URLSearchParams({
    mode: 'join',
    addr,
    name,
    v: '1.2.3',
  });
  return `http://127.0.0.1:${UI_PORT}/?${params.toString()}`;
}

function launcherStatePayload() {
  const settings = readPlayerSettings();
  return {
    uiPort: UI_PORT,
    lastJoinAddress: settings.lastJoinAddress ?? '',
  };
}

async function openGameWindow(joinAddress: string): Promise<void> {
  const url = gameUrl(joinAddress);
  writePlayerSettings({ lastJoinAddress: joinAddress.trim() });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: true,
    autoHideMenuBar: true,
    title: 'FTC Sim Player — Join',
    backgroundColor: '#0b0d0d',
    webPreferences: gameWebPreferences,
  });

  gameWindows.add(win);

  win.on('closed', () => {
    gameWindows.delete(win);
    if (gameWindows.size === 0) {
      launcherWindow?.show();
      void sendLauncherState();
    }
  });

  win.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    console.error(`[game] failed to load ${failedUrl}: ${code} ${description}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[game] render process gone:', details.reason);
  });

  await win.loadURL(url);
  launcherWindow?.hide();
  void sendLauncherState();
}

async function sendLauncherState(): Promise<void> {
  if (!launcherWindow) return;
  launcherWindow.webContents.send('launcher:state', launcherStatePayload());
}

async function createLauncherWindow(): Promise<void> {
  launcherWindow = new BrowserWindow({
    width: 420,
    height: 420,
    resizable: false,
    autoHideMenuBar: true,
    title: 'FTC Sim Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await launcherWindow.loadFile(launcherHtmlPath());
  launcherWindow.on('closed', () => {
    launcherWindow = null;
    for (const win of [...gameWindows]) {
      if (!win.isDestroyed()) {
        win.close();
      }
    }
  });
  launcherWindow.webContents.on('did-finish-load', () => {
    void sendLauncherState();
  });
}

function registerLauncherIpc(): void {
  ipcMain.handle('launcher:open-join', async (_event, address?: string) => {
    const trimmed = String(address ?? '').trim();
    if (!trimmed) {
      throw new Error('Enter the host address (e.g. 192.168.1.5:5191)');
    }
    await openGameWindow(trimmed);
  });

  ipcMain.handle('launcher:get-state', () => launcherStatePayload());

  ipcMain.handle('launcher:open-join-help', () => {
    shell.openExternal(JOIN_HELP_DOC);
  });

  ipcMain.handle('launcher:open-release-page', () => {
    shell.openExternal(RELEASE_PAGE);
  });

  ipcMain.handle('launcher:download-update', async (_event, version?: string) => {
    const target = version ?? getPendingUpdateVersion();
    if (!target) {
      return { ok: false, error: 'No update version available' };
    }
    return startDownload(target, () => launcherWindow);
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.show();
      launcherWindow.focus();
    } else {
      void createLauncherWindow();
    }
  });

  app.whenReady().then(async () => {
    registerLauncherIpc();
    uiServer = await startStaticServer(webRoot(), UI_PORT);
    await createLauncherWindow();
    setupAutoUpdater(() => launcherWindow);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createLauncherWindow();
    }
  });
}

app.on('window-all-closed', () => {
  uiServer?.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  uiServer?.close();
});
