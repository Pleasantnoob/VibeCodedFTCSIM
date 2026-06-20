import { contextBridge, ipcRenderer } from 'electron';

export interface LauncherState {
  uiPort: number;
  lastJoinAddress: string;
}

contextBridge.exposeInMainWorld('ftcLauncher', {
  getState: (): Promise<LauncherState> => ipcRenderer.invoke('launcher:get-state'),
  onState: (handler: (state: LauncherState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: LauncherState) => handler(state);
    ipcRenderer.on('launcher:state', listener);
    return () => ipcRenderer.removeListener('launcher:state', listener);
  },
  openJoin: (address: string): Promise<void> => ipcRenderer.invoke('launcher:open-join', address),
  openJoinHelp: (): Promise<void> => ipcRenderer.invoke('launcher:open-join-help'),
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
