import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type Docker from "dockerode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { containerCreateOptions } from "./computer-spec.js";
import {
  ComputerNetworkPolicySchema,
  computerHomeBelongsToInstallation,
  computerNetworkRules,
  enforceComputerNetworkPolicy,
  NETWORK_READY_PATH,
  networkPolicyFingerprint,
  readComputerNetworkPolicies,
} from "./network-policy.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("operator computer network policy", () => {
  it("keeps existing installations unrestricted and gates opted-in computers before desktop startup", async () => {
    expect((await readComputerNetworkPolicies(undefined, "/missing")).default).toEqual({
      mode: "unrestricted",
    });
    const input = {
      name: "test",
      image: "computer",
      botId: "bot",
      spaceId: "space",
      homePath: "/data/home",
    };
    expect(containerCreateOptions(input)).not.toHaveProperty("Cmd");
    const restricted = containerCreateOptions({
      ...input,
      networkPolicyFingerprint: networkPolicyFingerprint({ mode: "none" }),
    });
    expect(restricted.Cmd?.join(" ")).toContain(NETWORK_READY_PATH);
    expect(restricted.HostConfig.Tmpfs).toHaveProperty("/run/engaz-network");
    expect(restricted.HostConfig.CapDrop).toEqual(["ALL"]);
  });

  it.each([
    "169.254.169.254",
    "100.100.100.200",
    "127.0.0.11",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00:0ec2:0:0:0:0:0:0254",
    "::ffff:10.0.0.1",
    "2002:0a00:1::",
    "10.0.0.1; accept",
  ])("refuses unsafe or injected approved address %s", (address) => {
    expect(
      ComputerNetworkPolicySchema.safeParse({ mode: "approved", addresses: [address] }).success,
    ).toBe(false);
  });

  it("permits explicit owner LAN destinations while keeping metadata forbidden", () => {
    expect(
      ComputerNetworkPolicySchema.parse({
        mode: "approved",
        addresses: ["10.0.0.4", "fd12::4", "2606:4700:4700::1111"],
      }),
    ).toBeTruthy();
    const rules = computerNetworkRules({ mode: "approved", addresses: ["10.0.0.4", "fd12::4"] });
    expect(rules).toContain("policy drop");
    expect(rules).toContain("ip daddr { 10.0.0.4 } accept");
    expect(rules).toContain("ip6 daddr { fd12::4 } accept");
    expect(rules.indexOf("169.254.0.0/16")).toBeLessThan(rules.indexOf("10.0.0.4"));
    expect(rules).not.toContain("ct state established");
    expect(rules).toContain("ct direction reply accept");
  });

  it("blocks embedded DNS with no network and approved IP policies", () => {
    expect(computerNetworkRules({ mode: "none" })).toContain("ip daddr 127.0.0.11 drop");
    const rules = computerNetworkRules({ mode: "public" });
    expect(rules).toContain("172.16.0.0/12");
    expect(rules).toContain("ip6 daddr 2000::/3 accept");
    expect(rules).toContain("2002::/16");
  });

  it("discovers only computers whose durable home belongs to this installation", () => {
    const computer = {
      Config: { Labels: { "engaz.botId": "bot-1" } },
      Mounts: [{ Destination: "/home/engaz", Type: "bind", Source: "/data/homes/bot-1" }],
      HostConfig: {},
    } as unknown as Docker.ContainerInspectInfo;
    expect(computerHomeBelongsToInstallation(computer, "/data")).toBe(true);
    expect(computerHomeBelongsToInstallation(computer, "/other")).toBe(false);
    computer.HostConfig.Mounts = [
      {
        Target: "/home/engaz",
        Type: "volume",
        Source: "appdata",
        VolumeOptions: {
          NoCopy: false,
          Labels: {},
          DriverConfig: { Name: "local", Options: {} },
          Subpath: "homes/bot-1",
        },
      },
    ];
    const mount = {
      Type: "volume",
      Name: "appdata",
      Destination: "/data",
    } as Docker.ContainerInspectInfo["Mounts"][number];
    expect(computerHomeBelongsToInstallation(computer, "/data", mount)).toBe(true);
    expect(computerHomeBelongsToInstallation(computer, "/data", { ...mount, Name: "other" })).toBe(
      false,
    );
  });

  it("stops the computer when the platform cannot enforce the policy", async () => {
    const stop = vi.fn(async () => undefined);
    const container = {
      exec: vi.fn(async () => ({
        start: async () => {
          const stream = new PassThrough();
          setImmediate(() => stream.end());
          return stream;
        },
        inspect: async () => ({ ExitCode: 1 }),
      })),
      stop,
    } as unknown as Docker.Container;
    await expect(enforceComputerNetworkPolicy(container, { mode: "none" })).rejects.toThrow(
      "enforcement is unavailable",
    );
    expect(stop).toHaveBeenCalledWith({ t: 0 });
  });

  it("rejects policy files in shared data, writable by others, or with unknown fields", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "engaz-network-policy-"));
    directories.push(directory);
    const data = path.join(directory, "data");
    await mkdir(data);
    const file = path.join(directory, "policy.json");
    await writeFile(file, JSON.stringify({ default: { mode: "none" } }), { mode: 0o600 });
    expect((await readComputerNetworkPolicies(file, data)).default.mode).toBe("none");
    await writeFile(path.join(data, "policy.json"), "{}", { mode: 0o600 });
    await expect(readComputerNetworkPolicies(path.join(data, "policy.json"), data)).rejects.toThrow(
      "outside shared agent data",
    );
    await chmod(file, 0o666);
    await expect(readComputerNetworkPolicies(file, data)).rejects.toThrow("not writable by others");
    await chmod(file, 0o600);
    await writeFile(file, JSON.stringify({ default: { mode: "none", bypass: true } }));
    await expect(readComputerNetworkPolicies(file, data)).rejects.toThrow();
  });
});
