import { buildTrustedOrigins } from "@engaz/auth";
import type { AppEnv } from "./env.js";

type OriginEnv = Pick<
  AppEnv,
  "nodeEnv" | "webOrigin" | "apiUrl" | "authUrl" | "ownerSetupKey" | "authTrustedOrigins"
>;

export function authExtraOrigins(env: OriginEnv): string[] {
  return [
    ...(env.authTrustedOrigins ?? []),
    "engaz://",
    "exp://",
    "exp://*",
    ...(env.nodeEnv === "development"
      ? [
          "http://localhost:8081",
          "http://127.0.0.1:8081",
          "http://localhost:19006",
          "http://127.0.0.1:19006",
        ]
      : []),
  ];
}

export function isTrustedApiOrigin(origin: string, env: OriginEnv): boolean {
  if (!origin) return true;
  if (origin.startsWith("engaz://") || origin.startsWith("exp://")) return true;
  const configured = buildTrustedOrigins({
    webOrigin: env.webOrigin,
    baseURL: env.authUrl,
    extraOrigins: [...authExtraOrigins(env), env.apiUrl],
  });
  if (configured.includes(origin)) return true;
  if (env.ownerSetupKey || env.authTrustedOrigins?.length) return false;
  // Keep existing desktop/development installations working when no new LAN
  // authentication configuration was introduced.
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}
