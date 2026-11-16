/** The small Cloudflare boundary used by this worker; tests supply an offline implementation. */
export interface SessionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(timestamp: number): Promise<void>;
}
export interface SessionState {
  storage: SessionStorage;
}
export interface SessionNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
export interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
export interface Env {
  AUTH_START_LIMITER: RateLimiter;
  TOKEN_REQUEST_LIMITER: RateLimiter;
  SESSIONS: SessionNamespace;
  PUBLIC_ORIGIN: string;
  PROVIDERS: string;
  TOKEN_KEY: string;
  PUBLIC_CLIENTS?: string;
}
export type Provider = "google" | "slack" | "notion" | "linear";
export interface Client {
  clientId: string;
  clientSecret: string;
}
export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType: "Bearer";
  brokerCredential?: string;
}
