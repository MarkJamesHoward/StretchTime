import { app, ipcMain } from 'electron';
import { TrayManager } from './tray';
import { getSettings, updateSettings } from './store';

let trayManager: TrayManager;

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('ready', () => {
  // Don't show in taskbar - tray only
  app.dock?.hide?.();

  trayManager = new TrayManager();
  trayManager.init();
});

// Keep app running when all windows closed (tray app)
app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});

// IPC handlers for settings UI
ipcMain.handle('get-settings', () => {
  const s = getSettings();
  return {
    stretchIntervalMinutes: s.stretchIntervalMinutes,
    preMeetingBufferMinutes: s.preMeetingBufferMinutes,
    snoozeDurationMinutes: s.snoozeDurationMinutes,
    calendarProviders: s.calendarProviders,
    blockOnTentative: s.blockOnTentative,
    googleClientId: s.googleClientId,
    outlookClientId: s.outlookClientId,
    outlookTenantId: s.outlookTenantId,
    googleConnected: !!s.googleTokens?.refresh_token,
    outlookConnected: !!s.outlookTokens?.accessToken,
  };
});

ipcMain.handle('update-settings', (_event, partial) => {
  updateSettings(partial);
  return true;
});

ipcMain.handle('connect-google', async () => {
  try {
    await trayManager.getCalendarManager().getGoogleClient().authenticate();
    updateSettings({ calendarProviders: { ...getSettings().calendarProviders, google: true } });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('disconnect-google', () => {
  trayManager.getCalendarManager().getGoogleClient().disconnect();
  updateSettings({ calendarProviders: { ...getSettings().calendarProviders, google: false } });
  return true;
});

ipcMain.handle('connect-outlook', async () => {
  try {
    await trayManager.getCalendarManager().getOutlookClient().authenticate();
    updateSettings({ calendarProviders: { ...getSettings().calendarProviders, outlook: true } });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('disconnect-outlook', () => {
  trayManager.getCalendarManager().getOutlookClient().disconnect();
  updateSettings({ calendarProviders: { ...getSettings().calendarProviders, outlook: false } });
  return true;
});
