import Store from 'electron-store';

export interface AppSettings {
  stretchIntervalMinutes: number;
  preMeetingBufferMinutes: number;
  snoozeDurationMinutes: number;
  calendarProviders: {
    google: boolean;
    outlook: boolean;
  };
  blockOnTentative: boolean;
  googleClientId: string;
  outlookClientId: string;
  outlookTenantId: string;
  googleTokens?: {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
  };
  outlookTokens?: {
    accessToken: string;
    refreshToken: string;
    expiresOn: number;
  };
}

const defaults: AppSettings = {
  stretchIntervalMinutes: 30,
  preMeetingBufferMinutes: 15,
  snoozeDurationMinutes: 5,
  calendarProviders: {
    google: false,
    outlook: false,
  },
  blockOnTentative: true,
  googleClientId: '',
  outlookClientId: '7f6d8ba2-c83e-498f-86b6-77eb0375e03f',
  outlookTenantId: 'consumers',
};

const store = new Store<AppSettings>({ defaults });

export function getSettings(): AppSettings {
  return {
    stretchIntervalMinutes: store.get('stretchIntervalMinutes'),
    preMeetingBufferMinutes: store.get('preMeetingBufferMinutes'),
    snoozeDurationMinutes: store.get('snoozeDurationMinutes'),
    calendarProviders: store.get('calendarProviders'),
    blockOnTentative: store.get('blockOnTentative'),
    googleClientId: store.get('googleClientId'),
    outlookClientId: store.get('outlookClientId'),
    outlookTenantId: store.get('outlookTenantId'),
    googleTokens: store.get('googleTokens'),
    outlookTokens: store.get('outlookTokens'),
  };
}

export function updateSettings(partial: Partial<AppSettings>): void {
  for (const [key, value] of Object.entries(partial)) {
    store.set(key as keyof AppSettings, value);
  }
}

export { store };
