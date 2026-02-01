import { shell } from 'electron';
import { getSettings, updateSettings } from './store';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';

const REDIRECT_URI = 'http://localhost:8235/oauth2callback';
const SCOPES = 'Calendars.Read User.Read offline_access';

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

export class OutlookCalendarClient {
  private accessToken: string = '';
  private refreshToken: string = '';
  private expiresOn: number = 0;
  private authServer: http.Server | null = null;

  constructor() {
    const tokens = getSettings().outlookTokens;
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.expiresOn = tokens.expiresOn;
    }
  }

  isConnected(): boolean {
    return !!getSettings().outlookTokens?.refreshToken;
  }

  async authenticate(): Promise<void> {
    const settings = getSettings();
    const CLIENT_ID = settings.outlookClientId;
    const TENANT_ID = settings.outlookTenantId || 'consumers';

    if (!CLIENT_ID) {
      throw new Error('Outlook Client ID not configured. Set it in Settings.');
    }

    const { verifier, challenge } = generatePKCE();

    const authUrl = new URL(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('prompt', 'select_account');

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
          res.end(`<html><body><h2>Authentication failed</h2><p>${queryParams.error_description || queryParams.error}</p></body></html>`);
          done(() => reject(new Error(queryParams.error as string)));
        }
      });

      this.authServer.on('error', (err: Error) => {
        done(() => reject(err));
      });

      const timer = setTimeout(() => {
        done(() => reject(new Error('Authentication timed out')));
      }, 120_000);

      this.authServer.listen(8235, () => {
        console.log('Outlook OAuth URL:', authUrl.toString());
        console.log('Client ID:', CLIENT_ID);
        console.log('Tenant:', TENANT_ID);
        shell.openExternal(authUrl.toString());
      });
    });
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<void> {
    const settings = getSettings();
    const CLIENT_ID = settings.outlookClientId;
    const TENANT_ID = settings.outlookTenantId || 'consumers';
    const params = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
      scope: SCOPES,
    });

    const response = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
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
    this.expiresOn = Date.now() + tokens.expires_in * 1000;

    updateSettings({
      outlookTokens: {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresOn: this.expiresOn,
      },
    });
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) return;

    const settings = getSettings();
    const CLIENT_ID = settings.outlookClientId;
    const TENANT_ID = settings.outlookTenantId || 'consumers';
    const params = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      scope: SCOPES,
    });

    const response = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      console.error('Outlook token refresh failed');
      return;
    }

    const tokens: any = await response.json();
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token || this.refreshToken;
    this.expiresOn = Date.now() + tokens.expires_in * 1000;

    updateSettings({
      outlookTokens: {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresOn: this.expiresOn,
      },
    });
  }

  private async getValidAccessToken(): Promise<string> {
    if (Date.now() > this.expiresOn - 60_000) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  disconnect(): void {
    this.accessToken = '';
    this.refreshToken = '';
    this.expiresOn = 0;
    updateSettings({ outlookTokens: undefined });
  }

  async getUpcomingEvents(minutesAhead: number): Promise<CalendarEvent[]> {
    if (!this.isConnected()) return [];

    try {
      const token = await this.getValidAccessToken();
      const now = new Date();
      const later = new Date(now.getTime() + minutesAhead * 60_000);

      const params = new URLSearchParams({
        startDateTime: now.toISOString(),
        endDateTime: later.toISOString(),
        $select: 'subject,start,end,showAs',
        $orderby: 'start/dateTime',
      });

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        console.error('Outlook Calendar API error:', response.status);
        return [];
      }

      const data: any = await response.json();
      return (data.value || []).map((e: any) => ({
        summary: e.subject || '(No title)',
        start: new Date(e.start.dateTime + 'Z'),
        end: new Date(e.end.dateTime + 'Z'),
        status: e.showAs || 'busy',
      }));
    } catch (err) {
      console.error('Outlook Calendar error:', err);
      return [];
    }
  }
}
