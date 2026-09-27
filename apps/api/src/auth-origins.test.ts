import { describe, expect, it } from "vitest";
import { authExtraOrigins, isTrustedApiOrigin } from "./auth-origins.js";

const env = {
  nodeEnv: "production",
  webOrigin: "http://192.168.1.20:7791",
  authUrl: "http://192.168.1.20:7791",
  apiUrl: "http://192.168.1.20:7792",
  ownerSetupKey: "offline-setup-key",
  authTrustedOrigins: ["http://localhost:7791", "http://127.0.0.1:7791"],
};

describe("API LAN origin boundary", () => {
  it("accepts the configured web origins and refuses unlisted loopback/LAN ports", () => {
    for (const origin of [env.webOrigin, "http://localhost:7791", "http://127.0.0.1:7791"])
      expect(isTrustedApiOrigin(origin, env)).toBe(true);
    for (const origin of [
      "http://localhost:7792",
      "http://localhost:8081",
      "http://localhost:19006",
      "http://192.168.1.21:7791",
      "http://192.168.1.20:7793",
    ])
      expect(isTrustedApiOrigin(origin, env)).toBe(false);
    expect(authExtraOrigins(env)).not.toContain("http://localhost:8081");
  });
  it("keeps native schemes and legacy local/development origins", () => {
    expect(isTrustedApiOrigin("engaz://app", env)).toBe(true);
    expect(
      isTrustedApiOrigin("http://localhost:8081", {
        ...env,
        ownerSetupKey: undefined,
        authTrustedOrigins: [],
      }),
    ).toBe(true);
    expect(authExtraOrigins({ ...env, nodeEnv: "development" })).toContain("http://localhost:8081");
  });
});
