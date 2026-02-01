import { GoogleCalendarClient, CalendarEvent as GoogleEvent } from './google-calendar';
import { OutlookCalendarClient, CalendarEvent as OutlookEvent } from './outlook-calendar';
import { getSettings } from './store';

interface CachedEvents {
  events: Array<{ start: Date; end: Date; status: string }>;
  fetchedAt: number;
}

export class CalendarManager {
  private googleClient: GoogleCalendarClient;
  private outlookClient: OutlookCalendarClient;
  private cache: CachedEvents = { events: [], fetchedAt: 0 };
  private pollHandle: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 5 * 60_000; // 5 minutes
  private readonly CACHE_TTL = 5 * 60_000;

  constructor() {
    this.googleClient = new GoogleCalendarClient();
    this.outlookClient = new OutlookCalendarClient();
  }

  startPolling(): void {
    this.fetchEvents();
    this.pollHandle = setInterval(() => this.fetchEvents(), this.POLL_INTERVAL);
  }

  stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async fetchEvents(): Promise<void> {
    const settings = getSettings();
    const allEvents: Array<{ start: Date; end: Date; status: string }> = [];

    // Fetch up to 2 hours ahead to have a good cache window
    const lookAheadMinutes = 120;

    if (settings.calendarProviders.google && this.googleClient.isConnected()) {
      const events = await this.googleClient.getUpcomingEvents(lookAheadMinutes);
      allEvents.push(...events);
    }

    if (settings.calendarProviders.outlook && this.outlookClient.isConnected()) {
      const events = await this.outlookClient.getUpcomingEvents(lookAheadMinutes);
      allEvents.push(...events);
    }

    this.cache = { events: allEvents, fetchedAt: Date.now() };
  }

  async isBusyOrMeetingSoon(bufferMinutes: number): Promise<boolean> {
    // Refresh cache if stale
    if (Date.now() - this.cache.fetchedAt > this.CACHE_TTL) {
      await this.fetchEvents();
    }

    const settings = getSettings();
    const now = new Date();
    const bufferEnd = new Date(now.getTime() + bufferMinutes * 60_000);

    for (const event of this.cache.events) {
      // Skip tentative events if configured to ignore them
      if (!settings.blockOnTentative && event.status === 'tentative') {
        continue;
      }

      // Skip events marked as "free"
      if (event.status === 'free') {
        continue;
      }

      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);

      // Currently in a meeting
      if (eventStart <= now && eventEnd > now) {
        return true;
      }

      // Meeting starting within buffer window
      if (eventStart > now && eventStart <= bufferEnd) {
        return true;
      }
    }

    return false;
  }

  getGoogleClient(): GoogleCalendarClient {
    return this.googleClient;
  }

  getOutlookClient(): OutlookCalendarClient {
    return this.outlookClient;
  }
}
