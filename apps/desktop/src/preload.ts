import { contextBridge, ipcRenderer } from 'electron';

export interface LauncherState {
  uiPort: number;
  matchPort: number;
  lanAddress: string;
  matchServerRunning: boolean;
  internetAddress: string;
  publicIp: string | null;
  suggestedInternetAddress: string | null;
}

export interface PrepareInternetHostResult {
  inviteAddress: string;
  lanAddress: string;
  publicIp: string | null;
  firewallOk: boolean;
  upnpOk: boolean;
  notes: string[];
}

contextBridge.exposeInMainWorld('ftcLauncher', {
  getState: (): Promise<LauncherState> => ipcRenderer.invoke('launcher:get-state'),
  onState: (handler: (state: LauncherState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: LauncherState) => handler(state);
    ipcRenderer.on('launcher:state', listener);
    return () => ipcRenderer.removeListener('launcher:state', listener);
  },
  openSolo: (): Promise<void> => ipcRenderer.invoke('launcher:open-solo'),
  openHost: (): Promise<PrepareInternetHostResult> => ipcRenderer.invoke('launcher:open-host'),
  hostOnline: (): Promise<PrepareInternetHostResult> => ipcRenderer.invoke('launcher:host-online'),
  openJoin: (address: string): Promise<void> => ipcRenderer.invoke('launcher:open-join', address),
  openJoinLocal: (): Promise<void> => ipcRenderer.invoke('launcher:open-join-local'),
  copyLan: (): Promise<string> => ipcRenderer.invoke('launcher:copy-lan'),
  copyInternet: (): Promise<string> => ipcRenderer.invoke('launcher:copy-internet'),
  saveInternet: (address: string): Promise<string> => ipcRenderer.invoke('launcher:save-internet', address),
  detectPublicIp: (): Promise<{ publicIp: string | null; suggestedInternetAddress: string | null }> =>
    ipcRenderer.invoke('launcher:detect-public-ip'),
  openInternetGuide: (): Promise<void> => ipcRenderer.invoke('launcher:open-internet-guide'),
  stopServer: (): Promise<void> => ipcRenderer.invoke('launcher:stop-server'),
  // Legacy names
  copyPlayit: (): Promise<string> => ipcRenderer.invoke('launcher:copy-playit'),
  savePlayit: (address: string): Promise<string> => ipcRenderer.invoke('launcher:save-playit', address),
  openPlayitSetup: (): Promise<void> => ipcRenderer.invoke('launcher:open-playit-setup'),
  onUpdateAvailable: (
    handler: (info: { version: string; current: string } | null) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { version: string; current: string } | null) =>
      handler(info);
    ipcRenderer.on('launcher:update-available', listener);
    return () => ipcRenderer.removeListener('launcher:update-available', listener);
  },
  openReleasePage: (): Promise<void> => ipcRenderer.invoke('launcher:open-release-page'),
  downloadUpdate: (version?: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('launcher:download-update', version),
  onUpdateProgress: (
    handler: (info: { version: string; percent: number }) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { version: string; percent: number }) =>
      handler(info);
    ipcRenderer.on('launcher:update-progress', listener);
    return () => ipcRenderer.removeListener('launcher:update-progress', listener);
  },
});
