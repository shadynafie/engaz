# Engaz

**A self-hosted workspace for your AI team.** Create agents for different jobs, choose the models they use, teach them skills, and decide which services and tools each one may use.

Engaz runs on your own computer or NAS, and you use it in the browser. It does not offer a hosted service.

> **Current status:** Engaz is in active development, and the first release is the web app. The installer starts a fresh installation on amd64 and arm64 Linux in CI, and a new owner completes first run there. Real NAS and macOS installs, upgrades, and backup and restore of an image installation are not verified yet. The desktop and mobile apps come later.

## Install

Engaz needs Docker. On Linux the installer offers to install it; on macOS and Windows, install Docker Desktop first (on Windows, run the command inside WSL). Then run:

```bash
curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash
```

It asks where to keep your data, starts Engaz, and prints the address to open, `http://127.0.0.1:7791`. Run the same command again to update. The [self-hosting guide](./docs/self-host.md#published-images-no-checkout) covers the options, including [keeping data in a folder you choose](./docs/self-host.md#keep-data-in-a-folder-you-choose).

## First run

1. **Create your account.** The first account owns the installation. Create it before you make Engaz reachable from anywhere else.
2. **Connect a model.** Engaz sends it one test request and tells you what went wrong before anything is saved. For a model server on the same computer, use `host.docker.internal` instead of `localhost`.
3. **Build your team.** Your first agent, Chief, is ready to chat. Give agents skills from their settings, and connect plugins under **Integrations → MCP servers**, where you choose which agents may use each tool.
4. **Invite people.** Others join with a link from **Settings → People**.

To reach Engaz away from home, follow [the Cloudflare Tunnel steps](./docs/self-host.md#reach-engaz-away-from-home-cloudflare-tunnel).

## Keep your data

An installation is its database, its app data, and the `.env` file holding its secrets; keep all three. Never run `docker compose down -v` on an installation you care about: it deletes the data. See the [secrets checklist](./docs/self-host-secrets.md). Backup and restore are documented for the [source setup](./docs/self-host.md#backup); a tested backup for the image installation is still to come.

If you connect an external model or service, what you send it follows that provider's terms. See [privacy and data flow](./docs/privacy.md).

## About the project

Engaz builds on an Apache-2.0 licensed open-source project. Original copyright and attribution remain in [LICENSE](./LICENSE) and [NOTICE](./NOTICE). To run from source or help build it, see the [source setup](./docs/self-host.md#local-source-checkout) and [CONTRIBUTING.md](./CONTRIBUTING.md).
