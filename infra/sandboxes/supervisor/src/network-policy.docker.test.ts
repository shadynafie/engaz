import { randomUUID } from "node:crypto";
import Docker from "dockerode";
import { expect, it } from "vitest";
import { containerCreateOptions } from "./computer-spec.js";
import { enforceComputerNetworkPolicy, networkPolicyFingerprint } from "./network-policy.js";

// Isolated containers only. Set DOCKER_HOST explicitly when the default daemon is not the test daemon.
it.skipIf(process.env.VERIFY_DOCKER_NETWORK_POLICY !== "1")(
  "enforces shell and Chromium destinations, redirects, IPv6, revocation and reboot gating",
  async () => {
    const docker = new Docker();
    const suffix = randomUUID().slice(0, 8);
    const image = process.env.ENGAZ_COMPUTER_IMAGE ?? "engaz/computer:local";
    const created: Docker.Container[] = [];
    const network = await docker.createNetwork({
      Name: `engaz-network-test-${suffix}`,
      Driver: "bridge",
      EnableIPv6: true,
      IPAM: { Config: [{ Subnet: `fd81:${suffix.slice(0, 4)}:${suffix.slice(4)}::/64` }] },
    });
    const command = async (container: Docker.Container, argv: string[]) => {
      const exec = await container.exec({ Cmd: argv, AttachStdout: true, AttachStderr: true });
      const stream = await exec.start({ hijack: true, stdin: false });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      return { code: (await exec.inspect()).ExitCode, output: Buffer.concat(chunks).toString() };
    };
    try {
      const serverScript = `import http.server,socket,sys
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def do_GET(self):
  data=b'NETWORK_FIXTURE_REACHED'
  self.send_response(302 if self.path=='/redirect' else 200)
  if self.path=='/redirect': self.send_header('Location',sys.argv[1])
  self.send_header('Content-Length',str(len(data)))
  self.end_headers()
  self.wfile.write(data)
class Server(http.server.ThreadingHTTPServer): address_family=socket.AF_INET6
Server(('::',8080),Handler).serve_forever()`;
      const makeFixture = async (name: string, redirect = "http://127.0.0.1:1/") => {
        const container = await docker.createContainer({
          Image: image,
          name: `engaz-network-${name}-${suffix}`,
          User: "1000:1000",
          Cmd: ["python3", "-u", "-c", serverScript, redirect],
          HostConfig: {
            NetworkMode: network.id,
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges:true"],
          },
        });
        created.push(container);
        await container.start();
        return container;
      };
      const denied = await makeFixture("denied");
      const deniedInfo = await denied.inspect();
      const deniedIp = Object.values(deniedInfo.NetworkSettings.Networks)[0]!.IPAddress;
      const allowed = await makeFixture("allowed", `http://${deniedIp}:8080/`);
      const allowedInfo = await allowed.inspect();
      const allowedEndpoint = Object.values(allowedInfo.NetworkSettings.Networks)[0]!;
      const approved = {
        mode: "approved" as const,
        addresses: [allowedEndpoint.IPAddress, allowedEndpoint.GlobalIPv6Address],
      };
      const agent = await docker.createContainer({
        ...containerCreateOptions({
          name: `engaz-network-agent-${suffix}`,
          image,
          botId: `test-${suffix}`,
          spaceId: "test",
          homePath: "/unused",
          networkMode: network.id,
          controlToken: "test-network-control-token",
          networkPolicyFingerprint: networkPolicyFingerprint(approved),
        }),
        HostConfig: {
          ...containerCreateOptions({
            name: "unused",
            image,
            botId: "test",
            spaceId: "test",
            homePath: "/unused",
            networkPolicyFingerprint: "test",
          }).HostConfig,
          Binds: [],
          NetworkMode: network.id,
        },
      });
      created.push(agent);
      await agent.start();
      expect((await command(agent, ["pgrep", "Xvfb"])).code).not.toBe(0);
      expect((await command(agent, ["touch", "/run/engaz-network/ready"])).code).not.toBe(0);
      await enforceComputerNetworkPolicy(agent, approved);
      const socketProbe = (address: string) => [
        "python3",
        "-c",
        `import socket,sys
try:
 s=socket.create_connection((sys.argv[1],8080),1); s.sendall(b'GET / HTTP/1.1\\r\\nHost: fixture\\r\\nConnection: close\\r\\n\\r\\n'); print(s.recv(4096).decode())
except OSError: print('BLOCKED')`,
        address,
      ];
      await expect
        .poll(async () => (await command(agent, socketProbe(allowedEndpoint.IPAddress))).output)
        .toContain("200 OK");
      expect(
        (await command(agent, socketProbe(allowedEndpoint.GlobalIPv6Address))).output,
      ).toContain("200 OK");
      expect((await command(agent, socketProbe(deniedIp))).output).toContain("BLOCKED");
      expect((await command(agent, ["/usr/sbin/nft", "flush", "ruleset"])).code).not.toBe(0);
      const dnsProbe = [
        "env",
        "RES_OPTIONS=attempts:1 timeout:1",
        "python3",
        "-c",
        `import socket
try: print(socket.getaddrinfo('engaz-network-allowed-${suffix}',8080))
except OSError: print('DNS_BLOCKED')`,
      ];
      expect((await command(agent, dnsProbe)).output).toContain("DNS_BLOCKED");
      const browser = (url: string) => [
        "timeout",
        "12",
        "chromium",
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--no-proxy-server",
        "--disable-background-networking",
        "--timeout=3000",
        "--dump-dom",
        url,
      ];
      expect(
        (await command(agent, browser(`http://${allowedEndpoint.IPAddress}:8080/`))).output,
      ).toContain("NETWORK_FIXTURE_REACHED");
      const deniedBrowser = await command(agent, browser(`http://${deniedIp}:8080/`));
      expect(deniedBrowser.output).not.toContain("NETWORK_FIXTURE_REACHED");
      const redirected = await command(
        agent,
        browser(`http://${allowedEndpoint.IPAddress}:8080/redirect`),
      );
      expect(redirected.output).not.toContain("NETWORK_FIXTURE_REACHED");
      // Existing outbound connection must stop too; accepting all ESTABLISHED traffic would fail this.
      const connection = await agent.exec({
        Cmd: [
          "python3",
          "-c",
          `import http.client,socket,time
s=socket.create_connection(('${allowedEndpoint.IPAddress}',8080),1)
s.sendall(b'GET / HTTP/1.1\\r\\nHost: fixture\\r\\n\\r\\n'); response=http.client.HTTPResponse(s); response.begin(); response.read()
open('/tmp/network-connected','w').write('ready')
time.sleep(2)
s.settimeout(1)
try:
 s.sendall(b'GET / HTTP/1.1\\r\\nHost: fixture\\r\\n\\r\\n'); response=http.client.HTTPResponse(s); response.begin(); response.read(); result='ALLOWED'
except OSError: result='BLOCKED'
open('/tmp/network-revoked','w').write(result)`,
        ],
      });
      await connection.start({ Detach: true });
      await expect
        .poll(async () => (await command(agent, ["cat", "/tmp/network-connected"])).output)
        .toContain("ready");
      await enforceComputerNetworkPolicy(agent, { mode: "none" });
      await expect
        .poll(async () => (await command(agent, ["cat", "/tmp/network-revoked"])).output, {
          timeout: 6000,
        })
        .toContain("BLOCKED");
      expect((await command(agent, socketProbe(allowedEndpoint.IPAddress))).output).toContain(
        "BLOCKED",
      );
      const agentIp = Object.values((await agent.inspect()).NetworkSettings.Networks)[0]!.IPAddress;
      await expect
        .poll(
          async () =>
            (
              await command(allowed, [
                "python3",
                "-c",
                `import urllib.request
r=urllib.request.Request('http://${agentIp}:7070/v1/desktop',data=b'{"steps":[]}',headers={'Authorization':'Bearer test-network-control-token','Content-Type':'application/json'})
print(urllib.request.urlopen(r,timeout=2).status)`,
              ])
            ).output,
        )
        .toContain("200");
      await enforceComputerNetworkPolicy(agent, { mode: "public" });
      expect((await command(agent, dnsProbe)).output).not.toContain("DNS_BLOCKED");
      expect((await command(agent, socketProbe(allowedEndpoint.IPAddress))).output).toContain(
        "BLOCKED",
      );
      await agent.stop({ t: 0 });
      await agent.start();
      expect((await command(agent, ["test", "-e", "/run/engaz-network/ready"])).code).not.toBe(0);
      expect((await command(agent, ["pgrep", "Xvfb"])).code).not.toBe(0);
      await enforceComputerNetworkPolicy(agent, approved);
      expect((await command(agent, socketProbe(allowedEndpoint.IPAddress))).output).toContain(
        "200 OK",
      );
    } finally {
      await Promise.allSettled(
        created.reverse().map((container) => container.remove({ force: true })),
      );
      await network.remove();
    }
  },
  120_000,
);
