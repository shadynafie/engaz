import { abortableDelay } from "@engaz/core";
import { t } from "./i18n";

export type ConnectionAuthorization = {
  connectionId: string;
  authorizationUrl: string | null;
  authorizationId?: string;
  userCode?: string | null;
  verificationUri?: string | null;
  expiresAt?: string;
  pollIntervalSeconds?: number;
};

/** A shared native browser/device-code flow for Settings and in-chat connection cards. */
export async function finishConnectionAuthorization(
  started: ConnectionAuthorization,
  options: {
    signal: AbortSignal;
    openUrl: (url: string) => Promise<unknown>;
    confirmCode: (code: string) => Promise<boolean>;
    complete: (
      connectionId: string,
      authorizationId?: string,
    ) => Promise<{ status: string } | undefined>;
  },
): Promise<boolean | null> {
  const { signal } = options;
  if (signal.aborted) return false;
  const url = started.verificationUri || started.authorizationUrl;
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error(t("Invalid connection sign-in address."));
    if (started.userCode && !(await options.confirmCode(started.userCode))) return null;
    if (signal.aborted) return false;
    await options.openUrl(url);
  }
  const expiresAt = Math.min(
    Date.parse(started.expiresAt ?? "") || Date.now() + 120_000,
    Date.now() + 15 * 60_000,
  );
  const interval =
    Math.max(2, Number.isFinite(started.pollIntervalSeconds) ? started.pollIntervalSeconds! : 2) *
    1_000;
  if (started.pollIntervalSeconds && started.pollIntervalSeconds > 0) {
    await abortableDelay(Math.min(interval, Math.max(0, expiresAt - Date.now())), signal);
  }
  while (Date.now() < expiresAt) {
    if (signal.aborted) return false;
    const row = await options.complete(started.connectionId, started.authorizationId);
    if (signal.aborted) return false;
    if (row?.status === "connected") return true;
    if (row?.status === "error" || row?.status === "revoked")
      throw new Error(t("Could not connect. Try again."));
    await abortableDelay(Math.min(interval, Math.max(0, expiresAt - Date.now())), signal);
  }
  return false;
}
