import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import type { Server } from 'node:http';
import path from 'node:path';
import { readHostSettings, writeHostSettings } from './host-settings';
import { lanAddress } from './lan-address';
import { launcherHtmlPath, MATCH_PORT, UI_PORT, webRoot } from './paths';
import { isMatchServerRunning, startMatchServer, stopMatchServer, waitForMatchServerReady } from './match-server-child';
import { prepareInternetHost, unmapUpnpPort } from './internet-host';
import { fetchPublicIp, suggestedInternetAddress } from './public-ip';
import { startStaticServer } from './static-server';
import { resolveJoinAddress } from './join-address';
import { setupAutoUpdater, startDownload, getPendingUpdateVersion, manualCheckForUpdates } from './auto-updater';

const INTERNET_PLAY_DOC =
  'https://github.com/Pleasantnoob/VibeCodedFTCSIM/blob/main/docs/INTERNET_PLAY.md';

let uiServer: Server | null = null;
let launcherWindow: BrowserWindow | null = null;
const gameWindows = new Set<BrowserWindow>();
let hostWindowCount = 0;

const gameWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  backgroundThrottling: false,
} as const;

function gameUrl(mode: 'solo' | 'host' | 'join', opts?: { joinAddress?: string; name?: string }): string {
  if (mode === 'solo') {
    return `http://127.0.0.1:${UI_PORT}/`;
  }
  const addr =
    mode === 'join' && opts?.joinAddress?.trim()
      ? resolveJoinAddress(opts.joinAddress)
      : `127.0.0.1:${MATCH_PORT}`;
  const params = new URLSearchParams({
    mode,
    addr,
    name: opts?.name ?? 'Driver',
    v: '1.1.0',
  });
  return `http://127.0.0.1:${UI_PORT}/?${params.toString()}`;
}

function isLocalJoinAddress(address: string | undefined): boolean {
  const trimmed = String(address ?? '').trim().toLowerCase();
  if (!trimmed) return true;
  const host = trimmed.replace(/^wss?:\/\//, '').split(':')[0] ?? '';
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function launcherStatePayload() {
  const settings = readHostSettings();
  const publicIp = await fetchPublicIp();
  const suggested = suggestedInternetAddress(publicIp, MATCH_PORT);
  return {
    uiPort: UI_PORT,
    matchPort: MATCH_PORT,
    lanAddress: lanAddress(MATCH_PORT),
    matchServerRunning: isMatchServerRunning(),
    internetAddress: settings.internetAddress,
    publicIp,
    suggestedInternetAddress: suggested,
    appVersion: app.getVersion(),
  };
}

async function openGameWindow(
  mode: 'solo' | 'host' | 'join',
  opts?: { joinAddress?: string },
): Promise<void> {
  const url = gameUrl(mode, { joinAddress: opts?.joinAddress });
  const serverReady =
    mode === 'host' && !isMatchServerRunning()
      ? startMatchServer()
      : mode === 'join' && isLocalJoinAddress(opts?.joinAddress)
        ? waitForMatchServerReady(15_000)
        : Promise.resolve();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: true,
    autoHideMenuBar: true,
    title: mode === 'host' ? 'FTC Sim — Host' : mode === 'join' ? 'FTC Sim — Join' : 'FTC Sim',
    backgroundColor: '#0b0d0d',
    webPreferences: gameWebPreferences,
  });

  gameWindows.add(win);
  if (mode === 'host') {
    hostWindowCount += 1;
  }

  win.on('closed', () => {
    gameWindows.delete(win);
    if (mode === 'host') {
      hostWindowCount = Math.max(0, hostWindowCount - 1);
      if (hostWindowCount === 0 && isMatchServerRunning()) {
        stopMatchServer();
      }
    }
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

  win.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('error') || message.includes('Error') || message.includes('failed')) {
      console.log('[game-ui]', message);
    }
  });

  await Promise.all([win.loadURL(url), serverReady]);
  launcherWindow?.show();
  void sendLauncherState();
}

async function sendLauncherState(): Promise<void> {
  if (!launcherWindow) return;
  launcherWindow.webContents.send('launcher:state', await launcherStatePayload());
}

async function createLauncherWindow(): Promise<void> {
  launcherWindow = new BrowserWindow({
    width: 440,
    height: 680,
    resizable: false,
    autoHideMenuBar: true,
    title: 'FTCSIM Launcher',
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

async function launchHostMatch(copyInvite = false): Promise<Awaited<ReturnType<typeof prepareInternetHost>>> {
  await startMatchServer();
  await openGameWindow('host');
  const prep = await prepareInternetHost(MATCH_PORT);
  clipboard.writeText(copyInvite ? prep.inviteAddress : prep.lanAddress);
  await sendLauncherState();
  return prep;
}

function registerLauncherIpc(): void {
  ipcMain.handle('launcher:open-solo', async () => {
    await openGameWindow('solo');
  });

  ipcMain.handle('launcher:open-host', async () => {
    try {
      return await launchHostMatch(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  ipcMain.handle('launcher:host-online', async () => {
    try {
      return await launchHostMatch(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  ipcMain.handle('launcher:open-join-local', async () => {
    await openGameWindow('join', { joinAddress: `127.0.0.1:${MATCH_PORT}` });
  });

  ipcMain.handle('launcher:open-join', async (_event, address?: string) => {
    const trimmed = String(address ?? '').trim();
    if (!trimmed) {
      throw new Error('Enter the host address (e.g. 192.168.1.5:5191)');
    }
    await openGameWindow('join', { joinAddress: trimmed });
  });

  ipcMain.handle('launcher:copy-lan', () => lanAddress(MATCH_PORT));

  ipcMain.handle('launcher:write-clipboard', (_event, text: string) => {
    const value = String(text ?? '').trim();
    if (!value) {
      throw new Error('Nothing to copy');
    }
    clipboard.writeText(value);
  });

  ipcMain.handle('launcher:stop-server', () => {
    stopMatchServer();
    void sendLauncherState();
  });

  ipcMain.handle('launcher:get-state', () => launcherStatePayload());

  ipcMain.handle('launcher:save-internet', (_event, address: string) => {
    const saved = writeHostSettings({ internetAddress: String(address ?? '') });
    void sendLauncherState();
    return saved.internetAddress;
  });

  ipcMain.handle('launcher:copy-internet', (_event, address?: string) => {
    const typed = String(address ?? '').trim();
    if (typed) return typed;
    return readHostSettings().internetAddress ?? '';
  });

  ipcMain.handle('launcher:detect-public-ip', async () => {
    const publicIp = await fetchPublicIp();
    const suggested = suggestedInternetAddress(publicIp, MATCH_PORT);
    await sendLauncherState();
    return { publicIp, suggestedInternetAddress: suggested };
  });

  ipcMain.handle('launcher:open-internet-guide', () => {
    shell.openExternal(INTERNET_PLAY_DOC);
  });

  ipcMain.handle('launcher:open-release-page', () => {
    shell.openExternal('https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest');
  });

  ipcMain.handle('launcher:download-update', async (_event, version?: string) => {
    const target = version ?? getPendingUpdateVersion();
    if (!target) {
      return { ok: false, error: 'No update version available' };
    }
    return startDownload(target, () => launcherWindow);
  });

  ipcMain.handle('launcher:check-updates', () => manualCheckForUpdates(() => launcherWindow));

  // Legacy IPC names
  ipcMain.handle('launcher:save-playit', (_event, address: string) => {
    const saved = writeHostSettings({ internetAddress: String(address ?? '') });
    void sendLauncherState();
    return saved.internetAddress;
  });

  ipcMain.handle('launcher:copy-playit', async () => {
    const settings = readHostSettings();
    if (settings.internetAddress) clipboard.writeText(settings.internetAddress);
    return settings.internetAddress;
  });

  ipcMain.handle('launcher:open-playit-setup', () => {
    shell.openExternal(INTERNET_PLAY_DOC);
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
}

app.on('window-all-closed', () => {
  stopMatchServer();
  uiServer?.close();
  app.quit();
});

app.on('before-quit', () => {
  unmapUpnpPort(MATCH_PORT);
  stopMatchServer();
  uiServer?.close();
});
