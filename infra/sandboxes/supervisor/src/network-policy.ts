import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type Docker from "dockerode";
import { z } from "zod";

export const NETWORK_READY_PATH = "/run/engaz-network/ready";
export const NETWORK_POLICY_LABEL = "engaz.network-policy";
const TABLE = "engaz_egress";

const approvedAddress = z.string().refine((value) => {
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a !== 0 &&
      a !== 127 &&
      !(a === 169 && b === 254) &&
      !(a === 100 && b === 100 && value === "100.100.100.200") &&
      a !== undefined &&
      a < 224
    );
  }
  // Only global unicast and explicitly approved ULA; exclude translation/tunnel addresses.
  return (
    isIP(value) === 6 &&
    /^(?:[23][0-9a-f]{0,3}:|f[cd][0-9a-f]{0,2}:)/i.test(value) &&
    !/^200[12]:/i.test(value) &&
    new URL(`http://[${value}]`).hostname !== "[fd00:ec2::254]"
  );
}, "Approve a unicast IP address; loopback, metadata, link-local and tunnel addresses are forbidden");

export const ComputerNetworkPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unrestricted") }).strict(),
  z.object({ mode: z.literal("public") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({ mode: z.literal("approved"), addresses: z.array(approvedAddress).min(1).max(256) })
    .strict(),
]);
export type ComputerNetworkPolicy = z.infer<typeof ComputerNetworkPolicySchema>;
const policyFileSchema = z
  .object({
    default: ComputerNetworkPolicySchema.default({ mode: "unrestricted" }),
    agents: z.record(z.string(), ComputerNetworkPolicySchema).default({}),
  })
  .strict();

/** The operator file is never read from an agent-writable home or shared data mount. */
export async function readComputerNetworkPolicies(file: string | undefined, dataDir: string) {
  if (!file) return policyFileSchema.parse({});
  if (!path.isAbsolute(file)) throw new Error("Computer network policy file must be absolute");
  const resolved = await realpath(file);
  const data = await realpath(dataDir);
  const relative = path.relative(data, resolved);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    throw new Error("Computer network policy file must be outside shared agent data");
  }
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > 256 * 1024 ||
      (info.mode & 0o022) !== 0 ||
      (info.uid !== 0 && info.uid !== process.getuid?.())
    ) {
      throw new Error(
        "Computer network policy file must be operator-owned and not writable by others",
      );
    }
    return policyFileSchema.parse(JSON.parse(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
}

export function networkPolicyFingerprint(policy: ComputerNetworkPolicy) {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

/** Atomic replacement affects established outbound connections too; replies to inbound control remain usable. */
export function computerNetworkRules(policy: ComputerNetworkPolicy): string {
  const rules = [
    `flush table inet ${TABLE}`,
    `add chain inet ${TABLE} output { type filter hook output priority 0; policy ${policy.mode === "unrestricted" ? "accept" : "drop"}; }`,
  ];
  if (policy.mode === "unrestricted") return `${rules.join("\n")}\n`;
  const add = (rule: string) => rules.push(`add rule inet ${TABLE} output ${rule}`);
  add("ct direction reply accept");
  // Docker's embedded resolver can forward traffic off-host even though it is on loopback.
  if (policy.mode !== "public") add("ip daddr 127.0.0.11 drop");
  add('oifname "lo" accept');
  add("ip daddr { 0.0.0.0/8, 169.254.0.0/16, 100.100.100.200, 224.0.0.0/4, 240.0.0.0/4 } drop");
  add("ip6 daddr fd00:ec2::254 drop");
  if (policy.mode === "public") {
    add(
      "ip daddr { 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24 } drop",
    );
    add("meta nfproto ipv4 accept");
    add("ip6 daddr { 2001::/23, 2001:db8::/32, 2002::/16, 3fff::/20 } drop");
    add("ip6 daddr 2000::/3 accept");
  } else if (policy.mode === "approved") {
    for (const family of [4, 6]) {
      const addresses = policy.addresses.filter((address) => isIP(address) === family);
      if (addresses.length)
        add(`${family === 4 ? "ip" : "ip6"} daddr { ${addresses.join(", ")} } accept`);
    }
  }
  return `${rules.join("\n")}\n`;
}

/** Only the installation's own durable home mount can be acted on during policy discovery. */
export function computerHomeBelongsToInstallation(
  info: Docker.ContainerInspectInfo,
  dataDir: string,
  supervisorMount?: Docker.ContainerInspectInfo["Mounts"][number],
) {
  const botId = info.Config.Labels?.["engaz.botId"];
  if (!botId || !/^[a-zA-Z0-9_-]+$/.test(botId)) return false;
  const home = info.Mounts.find((mount) => mount.Destination === "/home/engaz");
  if (!home) return false;
  if (supervisorMount?.Type === "volume") {
    return (
      info.HostConfig.Mounts?.some(
        (mount) =>
          mount.Target === "/home/engaz" &&
          mount.Type === "volume" &&
          mount.Source === supervisorMount.Name &&
          mount.VolumeOptions?.Subpath === `homes/${botId}`,
      ) ?? false
    );
  }
  return (
    home.Type === "bind" &&
    home.Source === path.join(supervisorMount?.Source ?? dataDir, "homes", botId)
  );
}

async function privilegedCommand(container: Docker.Container, command: string[], input?: string) {
  const exec = await container.exec({
    Cmd: command,
    User: "0:0",
    Privileged: true,
    Env: ["PATH=/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root"],
    WorkingDir: "/",
    AttachStdin: input !== undefined,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: input !== undefined });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  if (input !== undefined) stream.end(input);
  await done;
  if ((await exec.inspect()).ExitCode !== 0) {
    // Do not include operator configuration or arbitrary Docker output in user-facing errors.
    throw new Error("Computer network enforcement is unavailable; computer stopped");
  }
  return Buffer.concat(chunks);
}

export async function enforceComputerNetworkPolicy(
  container: Docker.Container,
  policy: ComputerNetworkPolicy,
) {
  try {
    // Creation is idempotent. Replacement is one nft transaction, never a flush-and-allow window.
    await privilegedCommand(container, ["/usr/sbin/nft", "add", "table", "inet", TABLE]).catch(
      () => undefined,
    );
    await privilegedCommand(
      container,
      ["/usr/sbin/nft", "-f", "/dev/stdin"],
      computerNetworkRules(policy),
    );
    await privilegedCommand(container, ["/usr/bin/touch", NETWORK_READY_PATH]);
  } catch (error) {
    await container.stop({ t: 0 }).catch(() => undefined);
    throw error;
  }
}
