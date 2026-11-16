import type * as db from "@engaz/db";
import { describe, expect, it, vi } from "vitest";
import { chooseFocus, markAppConnected } from "./onboarding.js";

const posted = vi.hoisted(() => [] as Array<{ blocks: unknown[] }>);
vi.mock("@engaz/db", async (original) => ({
  ...(await original<typeof db>()),
  createThreadMessageInTransaction: vi.fn(async (_tx, input) => {
    posted.push(input);
    return { id: "posted" };
  }),
  appendEventInTransaction: vi.fn(async () => ({ seq: 1 })),
}));
function fixture(catalog: unknown[], assigned: Array<{ provider: string }> = []) {
  posted.length = 0;
  const tx = {
    $executeRaw: vi.fn(),
    message: {
      findMany: vi.fn(async () => [{ id: "choice", blocks: [{ kind: "choice", answerId: null }] }]),
      update: vi.fn(),
    },
  };
  const deps = {
    prisma: {
      connection: { findMany: vi.fn(async () => assigned) },
      bot: { findFirst: vi.fn(async () => ({ id: "bot", thread: { id: "thread" } })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    },
    events: { notify: vi.fn() },
    connectors: { managedProviders: () => [{ catalog: async () => catalog }] },
  } as unknown as Parameters<typeof chooseFocus>[0];
  const actor = {
    userId: "user",
    spaceId: "space",
    email: "user@engaz.test",
    isDeploymentOwner: true,
  };
  return { deps, actor, tx };
}
describe("onboarding connection suggestions", () => {
  it("does not invent authorization cards when no connector has an app catalog", async () => {
    const { deps, actor } = fixture([]);
    await chooseFocus(deps, actor, "bot", "day");
    expect(posted.flatMap((message) => message.blocks)).not.toContainEqual(
      expect.objectContaining({ kind: "app_connect" }),
    );
    expect(posted.length).toBeGreaterThan(0);
  });
  it("uses the available connector and omits unavailable apps", async () => {
    const { deps, actor } = fixture([
      {
        connectorId: "direct",
        slug: "slack",
        name: "Slack",
        connected: false,
        logo: null,
        available: true,
        setupRequired: false,
      },
      {
        connectorId: "direct",
        slug: "google",
        name: "Google Workspace",
        connected: false,
        logo: null,
        available: false,
        setupRequired: true,
      },
      {
        connectorId: "composio",
        slug: "microsoft",
        name: "Microsoft",
        connected: false,
        logo: null,
        available: true,
        setupRequired: false,
      },
    ]);
    await chooseFocus(deps, actor, "bot", "day");
    expect(
      posted
        .flatMap((message) => message.blocks)
        .filter((block) => (block as { kind: string }).kind === "app_connect"),
    ).toEqual([
      expect.objectContaining({ connectorId: "direct", provider: "slack", name: "Slack" }),
    ]);
  });
});

it("marks only the authorized connector when provider slugs collide", async () => {
  const { deps, actor, tx } = fixture([], [{ provider: "slackbot" }]);
  const blocks = ["composio", "pipedream"].map((connectorId) => ({
    kind: "app_connect",
    connectorId,
    provider: "slack",
    name: "Slack",
    status: "pending",
  }));
  deps.prisma.message = { findMany: vi.fn(async () => [{ id: "cards", blocks }]) } as never;
  await markAppConnected(deps, actor, "bot", "slack", "pipedream");
  expect(tx.message.update).toHaveBeenCalledWith({
    where: { id: "cards" },
    data: { blocks: [blocks[0], { ...blocks[1], status: "connected" }] },
  });
});

const slackCatalog = [
  {
    connectorId: "direct",
    slug: "slack",
    name: "Slack",
    connected: true,
    logo: null,
    available: true,
    setupRequired: false,
  },
];

it("keeps an account connected elsewhere pending until this agent receives access", async () => {
  const { deps, actor } = fixture(slackCatalog);
  await chooseFocus(deps, actor, "bot", "day");
  expect(posted.flatMap((message) => message.blocks)).toContainEqual(
    expect.objectContaining({ kind: "app_connect", provider: "slack", status: "pending" }),
  );
  expect(deps.prisma.connection.findMany).toHaveBeenCalledWith({
    where: {
      userId: "user",
      spaceId: "space",
      connectorId: "direct",
      status: "connected",
      botConnections: { some: { botId: "bot" } },
    },
    select: { provider: true },
  });
});

it("marks an available app connected only for a verified assigned account", async () => {
  const { deps, actor } = fixture(slackCatalog, [{ provider: "slack" }]);
  await chooseFocus(deps, actor, "bot", "day");
  expect(posted.flatMap((message) => message.blocks)).toContainEqual(
    expect.objectContaining({ kind: "app_connect", provider: "slack", status: "connected" }),
  );
});

it.each([
  { assigned: [] },
  { assigned: [{ provider: "github" }] },
  { assigned: [{ provider: "slackbot" }] },
])(
  "rejects a fabricated appConnected notification before reading or changing cards (%j)",
  async ({ assigned }) => {
    const { deps, actor, tx } = fixture([], assigned);
    deps.prisma.message = { findMany: vi.fn() } as never;
    await expect(markAppConnected(deps, actor, "bot", "slack", "direct")).rejects.toThrow(
      "Resource not found",
    );
    expect(deps.prisma.message.findMany).not.toHaveBeenCalled();
    expect(tx.message.update).not.toHaveBeenCalled();
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    expect(deps.events.notify).not.toHaveBeenCalled();
  },
);
