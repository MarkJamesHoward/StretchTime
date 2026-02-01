import { EventEmitter } from 'events';
import { getSettings } from './store';

export class StretchTimer extends EventEmitter {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastStretchTime: number = Date.now();
  private paused: boolean = false;
  private snoozedUntil: number = 0;

  start(): void {
    this.lastStretchTime = Date.now();
    this.paused = false;
    // Check every 30 seconds
    this.intervalHandle = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastStretchTime = Date.now();
  }

  isPaused(): boolean {
    return this.paused;
  }

  snooze(): void {
    const { snoozeDurationMinutes } = getSettings();
    this.snoozedUntil = Date.now() + snoozeDurationMinutes * 60_000;
  }

  resetTimer(): void {
    this.lastStretchTime = Date.now();
    this.snoozedUntil = 0;
  }

  getRemainingMs(): number {
    if (this.paused) return -1;
    const now = Date.now();
    if (now < this.snoozedUntil) {
      return this.snoozedUntil - now;
    }
    const { stretchIntervalMinutes } = getSettings();
    const remaining = (stretchIntervalMinutes * 60_000) - (now - this.lastStretchTime);
    return Math.max(0, remaining);
  }

  private tick(): void {
    this.emit('tick');

    if (this.paused) return;

    const now = Date.now();
    if (now < this.snoozedUntil) return;

    const { stretchIntervalMinutes } = getSettings();
    const elapsed = now - this.lastStretchTime;

    if (elapsed >= stretchIntervalMinutes * 60_000) {
      this.emit('stretch-due');
    }
  }
}
