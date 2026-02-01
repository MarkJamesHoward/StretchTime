import { shell } from 'electron';
import { getSettings, updateSettings } from './store';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';

const REDIRECT_URI = 'http://localhost:8234/oauth2callback';

export interface CalendarEvent {
  summary: string;
  start: Date;
  end: Date;
  status: string;
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export class GoogleCalendarClient {
  private accessToken: string = '';
  private refreshToken: string = '';
  private expiryDate: number = 0;
  private authServer: http.Server | null = null;

  constructor() {
    const tokens = getSettings().googleTokens;
    if (tokens) {
      this.accessToken = tokens.access_token;
      this.refreshToken = tokens.refresh_token;
      this.expiryDate = tokens.expiry_date;
    }
  }

  isConnected(): boolean {
    return !!getSettings().googleTokens?.refresh_token;
  }

  async authenticate(): Promise<void> {
    const CLIENT_ID = getSettings().googleClientId;
    if (!CLIENT_ID) {
      throw new Error('Google Client ID not configured. Set it in Settings.');
    }

    const { verifier, challenge } = generatePKCE();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Kill any leftover server from a previous failed attempt
    if (this.authServer) {
      try { this.authServer.close(); } catch {}
      this.authServer = null;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (this.authServer) {
          try { this.authServer.close(); } catch {}
          this.authServer = null;
        }
        clearTimeout(timer);
      };
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      this.authServer = http.createServer(async (req, res) => {
        const queryParams = url.parse(req.url || '', true).query;
        if (queryParams.code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authentication successful!</h2><p>You can close this window.</p></body></html>');
          try {
            await this.exchangeCodeForTokens(queryParams.code as string, verifier);
            done(() => resolve());
          } catch (err) {
            done(() => reject(err));
          }
        } else if (queryParams.error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h2>Authentication failed</h2><p>${queryParams.error}</p></body></html>`);
          done(() => reject(new Error(queryParams.error as string)));
        }
      });

      this.authServer.on('error', (err: Error) => {
        done(() => reject(err));
      });

      const timer = setTimeout(() => {
        done(() => reject(new Error('Authentication timed out')));
      }, 120_000);

      this.authServer.listen(8234, () => {
        shell.openExternal(authUrl.toString());
      });
    });
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<void> {
    const CLIENT_ID = getSettings().googleClientId;
    const params = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token exchange failed: ${body}`);
    }

    const tokens: any = await response.json();
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token || this.refreshToken;
    this.expiryDate = Date.now() + tokens.expires_in * 1000;

    updateSettings({
      googleTokens: {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        expiry_date: this.expiryDate,
      },
    });
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) return;

    const CLIENT_ID = getSettings().googleClientId;
    const params = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      console.error('Google token refresh failed');
      return;
    }

    const tokens: any = await response.json();
    this.accessToken = tokens.access_token;
    this.expiryDate = Date.now() + tokens.expires_in * 1000;

    updateSettings({
      googleTokens: {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        expiry_date: this.expiryDate,
      },
    });
  }

  private async getValidAccessToken(): Promise<string> {
    if (Date.now() > this.expiryDate - 60_000) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  disconnect(): void {
    this.accessToken = '';
    this.refreshToken = '';
    this.expiryDate = 0;
    updateSettings({ googleTokens: undefined });
  }

  async getUpcomingEvents(minutesAhead: number): Promise<CalendarEvent[]> {
    if (!this.isConnected()) return [];

    try {
      const token = await this.getValidAccessToken();
      const now = new Date();
      const later = new Date(now.getTime() + minutesAhead * 60_000);

      const params = new URLSearchParams({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: later.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
      });

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        console.error('Google Calendar API error:', response.status);
        return [];
      }

      const data: any = await response.json();
      return (data.items || [])
        .filter((e: any) => e.status !== 'cancelled')
        .map((e: any) => ({
          summary: e.summary || '(No title)',
          start: new Date(e.start?.dateTime || e.start?.date || ''),
          end: new Date(e.end?.dateTime || e.end?.date || ''),
          status: e.status || 'confirmed',
        }));
    } catch (err) {
      console.error('Google Calendar error:', err);
      return [];
    }
  }
}
