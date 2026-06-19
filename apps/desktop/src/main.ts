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
      ? opts.joinAddress.trim()
      : `127.0.0.1:${MATCH_PORT}`;
  const params = new URLSearchParams({
    mode,
    addr,
    name: opts?.name ?? 'Driver',
    v: '0.2.1',
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
    width: 420,
    height: 560,
    resizable: false,
    autoHideMenuBar: true,
    title: 'FTC Sim',
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
  ipcMain.handle('launcher:open-solo', async () => {
    await openGameWindow('solo');
  });

  ipcMain.handle('launcher:open-host', async () => {
    try {
      await openGameWindow('host');
      const addr = lanAddress(MATCH_PORT);
      clipboard.writeText(addr);
      await sendLauncherState();
      return addr;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  ipcMain.handle('launcher:host-online', async () => {
    try {
      await startMatchServer();
      const prep = await prepareInternetHost(MATCH_PORT);
      clipboard.writeText(prep.inviteAddress);
      await openGameWindow('host');
      await sendLauncherState();
      return prep;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  ipcMain.handle('launcher:open-join', async (_event, address?: string) => {
    const trimmed = String(address ?? '').trim();
    if (!trimmed) {
      throw new Error('Enter the host address (e.g. 192.168.1.5:5191)');
    }
    await openGameWindow('join', { joinAddress: trimmed });
  });

  ipcMain.handle('launcher:copy-lan', () => {
    const addr = lanAddress(MATCH_PORT);
    clipboard.writeText(addr);
    return addr;
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

  ipcMain.handle('launcher:copy-internet', () => {
    const addr = readHostSettings().internetAddress;
    if (addr) clipboard.writeText(addr);
    return addr;
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
