import type { TransactionalEmail } from "@engaz/adapter-kit";
import { bootstrapUserSpace } from "@engaz/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, OWNER_SETUP_HEADER } from "./index.js";

// Exercise Better Auth's real routing, password hashing, verification and
// session hooks with its official offline adapter. Only persistence is faked.
vi.mock("better-auth/adapters/prisma", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return {
    prismaAdapter: (prisma: { authData: Record<string, unknown[]> }) =>
      memoryAdapter(prisma.authData),
  };
});
vi.mock("@engaz/db", () => ({ bootstrapUserSpace: vi.fn(async () => ({ spaceId: "space-1" })) }));

function fixture({
  allowlist = "",
  delivery = true,
  baseURL = "http://auth.example.test",
  webOrigin = "http://web.example.test",
  requestOrigin,
  ownerSetupKey,
  extraOrigins,
}: {
  allowlist?: string;
  delivery?: boolean;
  baseURL?: string;
  webOrigin?: string;
  requestOrigin?: string;
  ownerSetupKey?: string;
  extraOrigins?: string[];
} = {}) {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const policy = {
    ownerUserId: null as string | null,
    signupsInviteOnly: true,
    signupsEnabled: true,
    signupAllowlist: allowlist,
    signupPolicyInitialized: true,
  };
  const messages: TransactionalEmail[] = [];
  const members = new Set<string>();
  const claims = new Map<string, { value: string }>();
  const prisma = {
    signupInvite: { findFirst: vi.fn(async () => null) },
    verification: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: { value: string };
          update: { value?: string };
        }) => {
          if (!claims.has(where.id)) claims.set(where.id, { ...create });
          else if (update.value) claims.set(where.id, { value: update.value });
          return claims.get(where.id)!;
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => claims.get(where.id) ?? null,
      ),
    },
    authData: data,
    deploymentSettings: {
      findUnique: vi.fn(async () => policy),
      updateMany: vi.fn(async () => {
        policy.ownerUserId = null;
        return { count: 1 };
      }),
    },
    member: { findMany: vi.fn(async () => []) },
    messagingIdentity: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    organization: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
        members.has(where.userId) ? { spaceId: "space-1" } : null,
      ),
    },
  };
  vi.mocked(bootstrapUserSpace).mockImplementation(async (_prisma, user) => {
    members.add(user.id);
    if (ownerSetupKey && !policy.ownerUserId) policy.ownerUserId = user.id;
    return { spaceId: "space-1" };
  });
  const auth = createAuth(prisma as never, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL,
    webOrigin,
    signupsEnabled: "true",
    signupAllowlist: "",
    ownerSetupKey,
    extraOrigins,
    email: delivery
      ? {
          describe: () => ({
            id: "offline-email",
            contractVersion: "1",
            adapterVersion: "1",
            capabilities: { transactional: true },
          }),
          send: async (message) => {
            messages.push(message);
          },
        }
      : undefined,
  });
  const request = (path: string, body?: unknown, token?: string, setup?: string) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          origin: requestOrigin ?? webOrigin,
          ...(setup ? { [OWNER_SETUP_HEADER]: setup } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const signup = (email = "approved@example.test", setup?: string) =>
    request(
      "/sign-up/email",
      {
        email,
        password: "offline-password12",
        name: "Test User",
        emailVerified: true,
        id: "msg-attacker-chosen-id",
      },
      undefined,
      setup,
    );
  const signin = (email = "approved@example.test") =>
    request("/sign-in/email", {
      email,
      password: "offline-password12",
    });
  const verify = () => {
    const url = new URL(messages.at(-1)!.text.match(/http:\/\/\S+/)![0]);
    return request(`${url.pathname.replace("/api/auth", "")}${url.search}`);
  };
  return { auth, request, signup, signin, verify, data, policy, messages, members, claims };
}

beforeEach(() => vi.clearAllMocks());

describe("loopback trusted origins", () => {
  it("accepts Origin localhost when webOrigin is 127.0.0.1", async () => {
    const f = fixture({
      delivery: false,
      baseURL: "http://127.0.0.1:7791",
      webOrigin: "http://127.0.0.1:7791",
      requestOrigin: "http://localhost:7791",
    });
    expect((await f.signup()).status).toBe(200);
  });

  it("accepts Origin 127.0.0.1 when webOrigin is localhost", async () => {
    const f = fixture({
      delivery: false,
      baseURL: "http://localhost:7791",
      webOrigin: "http://localhost:7791",
      requestOrigin: "http://127.0.0.1:7791",
    });
    expect((await f.signup()).status).toBe(200);
  });
});

describe("identity trust through auth endpoints", () => {
  it("keeps first-owner bootstrap and password signup available without email for open deployments", async () => {
    const f = fixture({ delivery: false });
    const response = await f.signup();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      user: { id: string; emailVerified: boolean };
    };
    expect(body.token).toEqual(expect.any(String));
    expect(body.user.emailVerified).toBe(false);
    expect(body.user.id).not.toBe("msg-attacker-chosen-id");
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);
    expect((await f.signin()).status).toBe(200);
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a matching allowlisted address when email delivery is unavailable", async () => {
    const f = fixture({ allowlist: "@example.test", delivery: false });
    expect((await f.signup()).status).toBe(400);
    expect(f.data.user).toHaveLength(0);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("requires mailbox proof before creating a session, space or first-owner claim", async () => {
    const f = fixture({ allowlist: "approved@example.test" });
    expect((await f.signup("outsider@example.test")).status).toBe(400);
    const response = await f.signup();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ token: null, user: { emailVerified: false } });
    expect(f.data.session).toHaveLength(0);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
    expect((await f.signin()).status).toBe(403);
    expect(f.messages).toHaveLength(2);
    expect((await f.request("/verify-email?token=forged-token")).status).not.toBe(200);
    expect(f.data.user![0]!.emailVerified).toBe(false);
    const verified = await f.verify();
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe("http://web.example.test/sign-in");
    expect(verified.headers.get("set-cookie")).toBeNull();
    expect(f.data.user![0]!.emailVerified).toBe(true);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
    const signedIn = await f.signin();
    expect(signedIn.status).toBe(200);
    const { token } = (await signedIn.json()) as { token: string };
    expect(token).toEqual(expect.any(String));
    expect(bootstrapUserSpace).toHaveBeenCalledTimes(1);
    expect(
      await f.auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }),
    ).toMatchObject({ user: { emailVerified: true } });
  });

  it("rechecks policy before admitting a verified but unprovisioned signup", async () => {
    const f = fixture({ allowlist: "@example.test" });
    await f.signup();
    await f.verify();
    f.policy.signupsEnabled = false;
    expect((await f.signin()).status).toBe(403);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
    f.policy.signupsEnabled = true;
    f.policy.signupAllowlist = "someone-else@example.test";
    expect((await f.signin()).status).toBe(403);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("gates existing unverified sessions and auth mutations when the live allowlist is enabled", async () => {
    const f = fixture();
    const signedUp = await f.signup();
    const cookie = signedUp.headers.get("set-cookie")!.split(";")[0]!;
    const { token } = (await signedUp.json()) as { token: string };
    expect(await f.auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    f.policy.signupAllowlist = "@example.test";
    expect(await f.auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await (await f.request("/get-session", undefined, token)).json()).toBeNull();
    expect(
      await f.auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }),
    ).toBeNull();
    expect((await f.request("/update-user", { name: "Changed" }, token)).status).toBe(401);
    expect((await f.signin()).status).toBe(403);
    await f.verify();
    expect((await f.signin()).status).toBe(200);
  });

  it("does not leak request-local verification settings when signup policy changes", async () => {
    const f = fixture({ allowlist: "@example.test" });
    expect(await (await f.signup()).json()).toMatchObject({ token: null });
    f.policy.signupAllowlist = "";
    expect(await (await f.signup("open@example.test")).json()).toMatchObject({
      token: expect.any(String),
    });
    expect(f.messages).toHaveLength(1);
    f.policy.signupAllowlist = "@example.test";
    expect(await (await f.signup("restricted@example.test")).json()).toMatchObject({ token: null });
    expect(f.messages).toHaveLength(2);
  });

  it("reserves internal messaging emails across registration, recovery and email changes", async () => {
    const f = fixture();
    for (const email of [
      "msg-sendblue15550001111@messaging.invalid",
      "MSG-Test@MESSAGING.INVALID",
    ]) {
      expect((await f.signup(email)).status).toBe(400);
      expect((await f.signin(email)).status).toBe(400);
      expect((await f.request("/request-password-reset", { email })).status).toBe(400);
      expect((await f.request("/send-verification-email", { email })).status).toBe(400);
    }
    expect(f.data.user).toHaveLength(0);
    const { token } = (await (await f.signup()).json()) as { token: string };
    expect(
      (await f.request("/change-email", { newEmail: "msg-taken@messaging.invalid" }, token)).status,
    ).toBe(400);
    // An account preclaimed before this upgrade must not keep its session.
    f.data.user![0]!.email = "msg-taken@messaging.invalid";
    expect(await (await f.request("/get-session", undefined, token)).json()).toBeNull();
    expect((await f.request("/update-user", { name: "Changed" }, token)).status).toBe(401);
    expect(f.messages).toHaveLength(0);
  });
});

describe("installer owner claim", () => {
  const key = "offline-setup-key-with-at-least-32-characters";

  it("rejects missing or incorrect keys before creating any account", async () => {
    const f = fixture({ delivery: false, ownerSetupKey: key });
    expect((await f.signup()).status).toBe(403);
    expect((await f.signup(undefined, "wrong-key")).status).toBe(403);
    expect(f.data.user).toHaveLength(0);
    expect(f.data.account).toHaveLength(0);
    expect(f.claims.size).toBe(0);
  });

  it("serializes concurrent email claims and requires invitations after the owner exists", async () => {
    const f = fixture({ delivery: false, ownerSetupKey: key });
    const responses = await Promise.all([
      f.signup("first@example.test", key),
      f.signup("second@example.test", key),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(f.data.user).toHaveLength(1);
    expect(f.data.account).toHaveLength(1);
    expect(f.members.size).toBe(1);
    expect((await f.signup("third@example.test", key)).status).toBe(403);
    expect(f.data.user).toHaveLength(1);
    expect(f.policy.ownerUserId).toBeTruthy();
  });

  it("keeps the binding when the owner disappears and rejects an unbound existing account", async () => {
    const f = fixture({ delivery: false, ownerSetupKey: key });
    expect((await f.signup("owner@example.test", key)).status).toBe(200);
    f.policy.signupsInviteOnly = false;
    expect((await f.signup("member@example.test")).status).toBe(200);
    const member = f.data.user!.find((u) => u.email === "member@example.test")!;
    f.members.delete(String(member.id));
    f.policy.ownerUserId = null;
    expect((await f.signin("member@example.test")).status).toBe(403);
    expect((await f.signup("replacement@example.test", key)).status).toBe(403);
    expect(f.claims.size).toBe(1);
  });

  it.each([false, true])(
    "does not reopen a consumed key after owner deletion (changed email: %s)",
    async (changedEmail) => {
      const f = fixture({ delivery: false, ownerSetupKey: key });
      const signup = await f.signup("owner@example.test", key);
      expect(signup.status).toBe(200);
      const { token } = (await signup.json()) as { token: string };
      if (changedEmail) f.data.user![0]!.email = "renamed@example.test";
      expect(
        (await f.request("/delete-user", { password: "offline-password12" }, token)).status,
      ).toBe(200);
      expect(f.data.user).toHaveLength(0);
      expect((await f.signup("owner@example.test", key)).status).toBe(403);
      expect(f.data.user).toHaveLength(0);
      expect([...f.claims.values()][0]!.value).toMatch(/^claimed:/);
    },
  );

  it("allows only the explicitly configured LAN origin and port", async () => {
    const options = {
      delivery: false,
      ownerSetupKey: key,
      baseURL: "http://192.168.1.20:7791",
      webOrigin: "http://192.168.1.20:7791",
      extraOrigins: ["http://localhost:7791", "http://127.0.0.1:7791"],
    };
    expect(
      (await fixture({ ...options, requestOrigin: "http://localhost:7791" }).signup(undefined, key))
        .status,
    ).toBe(200);
    expect(
      (
        await fixture({ ...options, requestOrigin: "http://192.168.1.21:7791" }).signup(
          undefined,
          key,
        )
      ).status,
    ).toBe(403);
    expect(
      (await fixture({ ...options, requestOrigin: "http://localhost:7792" }).signup(undefined, key))
        .status,
    ).toBe(403);
  });
});
