import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

const RELEASE_PAGE = 'https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest';

/** Check GitHub Releases (latest.yml) and prompt to download when a newer build exists. */
export function setupAutoUpdater(getLauncherWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest/download',
  });

  autoUpdater.on('update-available', (info) => {
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
          void shell.openExternal(RELEASE_PAGE);
        }
      });
  });

  autoUpdater.on('update-not-available', () => {
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
}
