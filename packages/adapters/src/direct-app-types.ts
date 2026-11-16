export interface DirectAppTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  brokerCredential?: string;
}

export interface DirectAppBroker {
  refreshAvailability?(): Promise<void>;
  available(provider: string): boolean;
  begin(input: {
    provider: string;
    redirectUrl: string;
    state: string;
    installationId: string;
  }): Promise<{ authorizationUrl: string; sessionId: string; expiresAt: string }>;
  complete(input: {
    provider: string;
    sessionId: string;
    state: string;
    code?: string;
  }): Promise<DirectAppTokens | null>;
  refresh(input: {
    provider: string;
    refreshToken: string;
    brokerCredential?: string;
  }): Promise<DirectAppTokens>;
  revoke?(input: {
    provider: string;
    accessToken: string;
    refreshToken?: string;
    brokerCredential?: string;
  }): Promise<void>;
}

export interface DirectAppSettings {
  githubClientId?: string;
  microsoftClientId?: string;
  connectUrl?: string;
}

export function parseDirectAppSettings(value?: string): DirectAppSettings {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("DIRECT_APP_SETTINGS must be a JSON object");
  const settings = parsed as Record<string, unknown>;
  for (const key of Object.keys(settings)) {
    if (
      !["githubClientId", "microsoftClientId", "connectUrl"].includes(key) ||
      typeof settings[key] !== "string" ||
      String(settings[key]).length > 2_048
    )
      throw new Error("Invalid DIRECT_APP_SETTINGS");
  }
  return settings as DirectAppSettings;
}
