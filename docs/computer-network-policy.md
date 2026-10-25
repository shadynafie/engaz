# Optional computer network restrictions

This is an operator configuration for local Docker agent computers. Existing installations keep their current network behavior unless the operator enables it. It applies to commands and browsers in the computer, including programs that ignore proxy settings. API-side plugins, MCP servers, model requests and remote computer providers have their own permissions; this policy does not restrict those services.

## Modes

| Mode | Outbound access |
| --- | --- |
| `unrestricted` | Existing behavior. |
| `public` | Public internet destinations and Docker's embedded DNS resolver. Private, reserved, link-local, multicast, metadata and IPv6 translation/tunnel ranges are blocked. |
| `approved` | Only the literal IPv4/IPv6 addresses the operator lists. An owner-machine or LAN service needs an explicit entry. DNS is blocked; use an approved IP address. |
| `none` | No connections outside the computer. Docker's embedded DNS forwarding is blocked too. |

Restricted modes retain loopback inside the computer and replies to incoming screen/control connections. They never permit an agent to initiate connections to the supervisor or neighboring computers unless their IP is explicitly approved. Link-local and known metadata destinations cannot be approved.

Approval is at the IP address level and covers all ports at that address. It does not distinguish websites sharing an address. Domain names and CIDR ranges are deliberately not accepted in `approved` mode: DNS changes do not silently authorize another address, and redirects must still connect to an approved address. A changed service IP requires an operator policy update. Public mode can resolve a name to a private address, but cannot connect to it. Public mode classifies destinations by IP range; it cannot tell whether a globally routable address belongs to an internet service or to the owner's own publicly numbered LAN or host. Installations with such local services must use `approved` or `none` when those services need explicit grants. Public internet access can reach public proxies; this is a destination firewall, not a content filter.

## Enable deliberately

Stop the affected computers first using Engaz's existing computer controls. Store `policy.json` in an operator-owned directory outside Engaz's shared data directory and every agent home. The file must be owned by root or the supervisor's OS user and must not be writable by its group or other users. A typical mode is `0644`, or `0600` when the supervisor runs as its owner.

```json
{
  "default": { "mode": "public" },
  "agents": {
    "<agent-id>": { "mode": "approved", "addresses": ["192.168.1.20", "fd12::20"] },
    "<offline-agent-id>": { "mode": "none" }
  }
}
```

The `agents` keys are existing agent IDs. Omitting an agent uses `default`; omitting `default` keeps unrestricted access. No model chooses or edits this file.

For Compose, mount the operator directory read-only into the supervisor and set `ENGAZ_COMPUTER_NETWORK_POLICY_FILE` to the absolute container path. The optional [Compose override](../infra/compose/docker-compose.network-policy.yml) does this using `ENGAZ_NETWORK_POLICY_DIR`. Use it with the installation's existing Compose files and project identity; do not create a different project or move data volumes. A published-image installation can copy that override next to its existing Compose files. The supervisor must be recreated with the added mount and environment variable. This is an operator change, not an automatic migration.

The lifecycle CLI does not retain this optional override. After `engaz start` or `engaz update`, manually reapply it with the installation's existing Compose files and project identity, then start the affected computers explicitly. A supervisor recreated without the policy setting stops previously policy-managed computers; it does not grant unrestricted access. Back up the operator policy file, override and reapplication settings separately: the ordinary installation backup does not include them.

Starting an existing computer after enabling the policy may replace its container to install the boot gate. Its durable home is retained. The replacement requires the computer image shipped with this change, which includes `nftables`; older/custom images without enforcement support fail closed.

Replace `policy.json` atomically in the mounted directory to change or revoke access. The supervisor checks before allowing computer operations and checks running policy-managed computers every second. Revocation also blocks packets on existing outbound connections. Changes take effect while the supervisor and Docker daemon are available; if the supervisor is stopped, the last installed rules remain, and new configuration cannot be applied until it resumes. Invalid or unreadable policy stops affected computers rather than granting unrestricted access. On startup and during checks, the supervisor discovers this installation's running computers by their validated durable home mounts; an older computer without a boot gate is stopped and must be started again to install it. Computers belonging to other installations are excluded.

To remove restrictions deliberately, set the affected policy to `unrestricted`. Removing a file, making it invalid, or restarting the supervisor without its policy-file setting is not an unrestricted fallback. Previously policy-managed computers are stopped when their operator configuration is missing. Stopped computers must be started explicitly after an enforcement failure.

## Enforcement and platform limits

The supervisor asks the operator's Docker daemon to install an `inet` nftables OUTPUT policy in each computer's own network namespace. It does not modify host firewall rules or the networks of other services. The trusted installation command runs as a privileged root Docker exec; ordinary agent commands retain their unprivileged user, all Linux capabilities dropped, and `no-new-privileges`. The agent has no Docker socket or policy-file mount.

An opted-in computer starts behind a root-owned tmpfs gate before its desktop starts. Rules are installed before the gate opens. Restarting the container clears the gate and requires enforcement again. Rules are replaced atomically; outgoing connections do not retain a blanket established-connection exemption. Replies to inbound control connections remain available.

The Docker daemon must support privileged root exec and network-namespace nftables. Rootless engines, hardened daemons, Docker Desktop backends and remote Docker configurations may refuse those operations. Unsupported restricted execution stops the computer and reports that enforcement is unavailable; it does not silently weaken the policy.

| Platform | Evidence |
| --- | --- |
| Linux Docker Engine in an arm64 development VM | Real disposable-container tests passed for shell and Chromium access, blocked redirects, IPv4/IPv6, DNS blocking, established-connection revocation, inbound control and restart gating. A real supervisor HTTP lifecycle test also passed operator-file startup, running-policy changes, invalid configuration, legacy-computer stopping, recreation with durable files, and omitted-configuration failure. |
| Other Linux/NAS engines, rootless Docker | Not yet verified. Capability failures stop the computer. |
| Docker Desktop on macOS/Windows | Not yet verified. Linux engine test results do not establish Desktop support. |
| Remote computer providers | Unchanged; this operator policy is local-Docker-only. |

Run the deterministic policy checks normally. The real enforcement test is opt-in and creates only disposable containers and one disposable network:

```bash
# Build the development computer image first, on an isolated development Docker daemon.
pnpm sandbox:build
VERIFY_DOCKER_NETWORK_POLICY=1 pnpm exec vitest run infra/sandboxes/supervisor/src/network-policy.docker.test.ts infra/sandboxes/supervisor/src/network-policy-lifecycle.docker.test.ts --maxWorkers=1 infra/sandboxes/supervisor/src/network-policy-lifecycle.docker.test.ts
```

Set `DOCKER_HOST` explicitly when needed to select the development daemon; `ENGAZ_COMPUTER_IMAGE` can select its development image. The test uses local HTTP fixtures and Chromium, with no model, credentials or external internet service.
