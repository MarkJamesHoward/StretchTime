import { Tray, Menu, nativeImage, BrowserWindow, Notification } from 'electron';
import * as path from 'path';
import { StretchTimer } from './timer';
import { CalendarManager } from './calendar';
import { getSettings } from './store';

export class TrayManager {
  private tray: Tray | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private timer: StretchTimer;
  private calendarManager: CalendarManager;

  constructor() {
    this.timer = new StretchTimer();
    this.calendarManager = new CalendarManager();
  }

  init(): void {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    let icon: Electron.NativeImage;
    try {
      icon = nativeImage.createFromPath(iconPath);
    } catch {
      // Fallback: create a simple colored icon
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(this.createFallbackIcon()) : icon);
    this.tray.setToolTip('StretchTime');
    this.updateContextMenu();

    this.timer.on('stretch-due', () => this.onStretchDue());
    this.timer.on('tick', () => this.updateTooltip());
    this.timer.start();
    this.updateTooltip();
    this.calendarManager.startPolling();
  }

  private createFallbackIcon(): Buffer {
    // 16x16 PNG with a green circle (minimal valid PNG)
    // This is a programmatically created tiny icon
    const { createCanvas } = (() => {
      try {
        return require('canvas');
      } catch {
        return { createCanvas: null };
      }
    })();

    // If canvas isn't available, return a minimal 1x1 PNG
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4y2Ng' +
      'YPj/n4EBFTAxMDCgAzC5GBgYGBhGXTDqgqHrAgBmvAQh2eCYrAAAAABJRU5ErkJggg==',
      'base64'
    );
  }

  private updateContextMenu(): void {
    const isPaused = this.timer.isPaused();
    const menu = Menu.buildFromTemplate([
      {
        label: isPaused ? 'Resume' : 'Pause',
        click: () => {
          if (isPaused) {
            this.timer.resume();
          } else {
            this.timer.pause();
          }
          this.updateContextMenu();
        },
      },
      {
        label: 'Stretch Now',
        click: () => this.showStretchNotification(),
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => this.openSettings(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.timer.stop();
          this.calendarManager.stopPolling();
          const { app } = require('electron');
          app.quit();
        },
      },
    ]);
    this.tray?.setContextMenu(menu);
  }

  private async onStretchDue(): Promise<void> {
    // Reset immediately so we don't fire again while awaiting calendar
    this.timer.resetTimer();

    const settings = getSettings();
    const isBusy = await this.calendarManager.isBusyOrMeetingSoon(
      settings.preMeetingBufferMinutes
    );

    if (isBusy) {
      return;
    }

    this.showStretchNotification();
  }

  private showStretchNotification(): void {
    const notification = new Notification({
      title: 'Time to Stretch!',
      body: 'You\'ve been sitting for a while. Take a moment to stand up and stretch.',
      silent: false,
    });

    notification.show();
  }

  openSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 500,
      height: 600,
      resizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      title: 'StretchTime Settings',
      autoHideMenuBar: true,
    });

    this.settingsWindow.loadFile(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html')
    );

    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });
  }

  private updateTooltip(): void {
    if (!this.tray) return;
    if (this.timer.isPaused()) {
      this.tray.setToolTip('StretchTime - Paused');
      return;
    }
    const ms = this.timer.getRemainingMs();
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    this.tray.setToolTip(`StretchTime - ${min}:${sec.toString().padStart(2, '0')} until next stretch`);
  }

  getCalendarManager(): CalendarManager {
    return this.calendarManager;
  }

  getTimer(): StretchTimer {
    return this.timer;
  }
}
