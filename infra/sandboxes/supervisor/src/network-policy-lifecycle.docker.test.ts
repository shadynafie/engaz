import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Docker from "dockerode";
import { expect, it } from "vitest";
import { computerNetworkNameFor, containerCreateOptions } from "./computer-spec.js";

it.skipIf(process.env.VERIFY_DOCKER_NETWORK_POLICY !== "1")(
  "applies operator files through real supervisor startup, revocation, invalidation and recreation",
  async () => {
    const docker = new Docker();
    const image = process.env.ENGAZ_COMPUTER_IMAGE ?? "engaz/computer:local";
    // Desktop Docker VMs share the home directory; native Linux can use its normal temporary root.
    const root = await mkdtemp(
      path.join(
        process.env.ENGAZ_NETWORK_TEST_ROOT ??
          (process.platform === "darwin" ? homedir() : tmpdir()),
        ".engaz-network-lifecycle-",
      ),
    );
    const data = path.join(root, "data");
    const file = path.join(root, "policy.json");
    const suffix = randomUUID().slice(0, 8);
    const botId = `policy-test-${suffix}`;
    const spaceId = `policy-space-${suffix}`;
    const home = path.join(data, "homes", botId);
    const token = `network-policy-test-token-${suffix}-not-a-secret`;
    const created: Docker.Container[] = [];
    let child: ReturnType<typeof spawn> | undefined;
    let processOutput = "";
    const reserve = http.createServer();
    await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-engaz-bot-id": botId,
      "x-engaz-space-id": spaceId,
    };
    const stopSupervisor = async () => {
      if (!child || child.exitCode !== null) return;
      const stopped = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await stopped;
    };
    const startSupervisor = async (configured = true) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DATA_DIR: data,
        ENGAZ_COMPUTER_IMAGE: image,
        SANDBOX_SUPERVISOR_TOKEN: token,
        SUPERVISOR_HOST: "127.0.0.1",
        SUPERVISOR_PORT: String(port),
        SANDBOX_SCREEN_NETWORK: "published",
        SANDBOX_CONTROL_VIA_LOOPBACK: "true",
        HOSTNAME: "",
        AXIOM_TOKEN: "",
        AXIOM_DATASET: "",
      };
      delete env.ENGAZ_COMPUTER_NETWORK_POLICY_FILE;
      if (configured) Object.assign(env, { ENGAZ_COMPUTER_NETWORK_POLICY_FILE: file });
      child = spawn(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          fileURLToPath(new URL("./index.ts", import.meta.url)),
        ],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout?.on("data", (chunk) => {
        processOutput += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        processOutput += String(chunk);
      });
      await expect
        .poll(
          async () => {
            if (child?.exitCode !== null)
              throw new Error(`Test supervisor exited: ${processOutput}`);
            return fetch(`${origin}/health`)
              .then((response) => response.ok)
              .catch(() => false);
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    };
    const setPolicy = async (value: unknown) => {
      await writeFile(`${file}.next`, typeof value === "string" ? value : JSON.stringify(value), {
        mode: 0o600,
      });
      await rename(`${file}.next`, file);
    };
    const provision = async () => {
      const response = await fetch(`${origin}/computers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ botId, spaceId, homePath: home }),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id)
        throw new Error(`Test provisioning failed: ${result.error ?? response.status}`);
      const container = docker.getContainer(result.id);
      created.push(container);
      return container;
    };
    const direct = async (container: Docker.Container, argv: string[]) => {
      const exec = await container.exec({ Cmd: argv, AttachStdout: true, AttachStderr: true });
      const stream = await exec.start({ hijack: true, stdin: false });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      return Buffer.concat(chunks).toString();
    };
    try {
      await mkdir(home, { recursive: true });
      // Prevent root-env discovery from reading any developer installation configuration.
      await writeFile(path.join(root, ".env"), "# isolated network lifecycle fixture\n");
      await writeFile(path.join(home, "retained.txt"), "durable fixture");
      await setPolicy({ default: { mode: "none" } });
      const legacyId = `legacy-${suffix}`;
      const legacyHome = path.join(data, "homes", legacyId);
      const foreignHome = path.join(root, "other-installation", "homes", `foreign-${suffix}`);
      await mkdir(legacyHome, { recursive: true });
      await mkdir(foreignHome, { recursive: true });
      const makeLegacy = async (id: string, directory: string) => {
        const computer = await docker.createContainer({
          ...containerCreateOptions({
            name: `engaz-network-${id}`,
            image,
            botId: id,
            spaceId,
            homePath: directory,
          }),
          Cmd: ["sleep", "120"],
        });
        created.push(computer);
        await computer.start();
        return computer;
      };
      const legacy = await makeLegacy(legacyId, legacyHome);
      const foreign = await makeLegacy(`foreign-${suffix}`, foreignHome);
      await startSupervisor();
      await expect
        .poll(async () => (await legacy.inspect()).State.Running, { timeout: 6000 })
        .toBe(false);
      expect((await foreign.inspect()).State.Running).toBe(true);
      const agent = await provision();
      const networkName = (await agent.inspect()).HostConfig.NetworkMode;
      const fixture = await docker.createContainer({
        Image: image,
        name: `engaz-policy-http-${suffix}`,
        User: "1000:1000",
        Cmd: ["python3", "-m", "http.server", "8080", "--bind", "0.0.0.0"],
        HostConfig: { NetworkMode: networkName, CapDrop: ["ALL"] },
      });
      created.push(fixture);
      await fixture.start();
      const target = Object.values((await fixture.inspect()).NetworkSettings.Networks)[0]!
        .IPAddress;
      const probe = [
        "python3",
        "-c",
        `import socket
try: socket.create_connection(('${target}',8080),0.5).close(); print('CONNECTED')
except OSError: print('BLOCKED')`,
      ];
      expect(await direct(agent, probe)).toContain("BLOCKED");
      await setPolicy({
        default: { mode: "none" },
        agents: { [botId]: { mode: "approved", addresses: [target] } },
      });
      await expect.poll(() => direct(agent, probe), { timeout: 6000 }).toContain("CONNECTED");
      await setPolicy({ default: { mode: "none" } });
      await expect.poll(() => direct(agent, probe), { timeout: 6000 }).toContain("BLOCKED");
      // A changed address is not silently authorized; only the explicit new policy opens it.
      await setPolicy("invalid JSON");
      await expect
        .poll(async () => (await agent.inspect()).State.Running, { timeout: 6000 })
        .toBe(false);
      const refused = await fetch(`${origin}/computers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ botId, spaceId, homePath: home }),
      });
      expect(refused.status).toBe(500);
      await setPolicy({ default: { mode: "none" } });
      const resumed = await provision();
      expect(resumed.id).toBe(agent.id);
      expect(await direct(resumed, ["cat", "/home/engaz/retained.txt"])).toContain(
        "durable fixture",
      );
      await resumed.remove({ force: true });
      const recreated = await provision();
      expect(recreated.id).not.toBe(agent.id);
      expect(await direct(recreated, probe)).toContain("BLOCKED");
      expect(await direct(recreated, ["cat", "/home/engaz/retained.txt"])).toContain(
        "durable fixture",
      );
      const execution = await fetch(`${origin}/computers/${recreated.id}/exec`, {
        method: "POST",
        headers,
        body: JSON.stringify({ argv: probe }),
      });
      expect(((await execution.json()) as { stdout: string }).stdout).toContain("BLOCKED");
      await stopSupervisor();
      await startSupervisor(false);
      await expect
        .poll(async () => (await recreated.inspect()).State.Running, { timeout: 6000 })
        .toBe(false);
      const noPolicy = await fetch(`${origin}/computers/${recreated.id}/exec`, {
        method: "POST",
        headers,
        body: JSON.stringify({ argv: ["true"] }),
      });
      expect(((await noPolicy.json()) as { stderr: string }).stderr).toContain("not configured");
      const cannotReplace = await fetch(`${origin}/computers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ botId, spaceId, homePath: home }),
      });
      expect(cannotReplace.status).toBe(500);
      expect((await foreign.inspect()).State.Running).toBe(true);
    } finally {
      await stopSupervisor();
      await Promise.allSettled(created.map((container) => container.remove({ force: true })));
      await docker
        .getNetwork(computerNetworkNameFor(botId))
        .remove()
        .catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);
