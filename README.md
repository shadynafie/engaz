# Engaz

**A self-hosted workspace for your AI team.** Create agents for different jobs, choose the models they use, teach them skills, and decide which services and tools each one may use.

Engaz runs on your own computer or NAS, and you use it in the browser. It does not offer a hosted service.

> **Current status:** Engaz is in active development, and the first release is the web app. The installer starts a fresh installation on amd64 and arm64 Linux in CI, and a new owner completes first run there. Linux update, backup, and restore checks pass. The macOS and Windows installer paths pass offline checks; real NAS, macOS, and Windows installation and recovery remain unverified. The desktop and mobile apps come later.

## Install

On **Linux or macOS**, open a terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash
```

On **Windows 10 (2004 or newer) or 11**, open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install.ps1 | iex
```

The installer asks before installing anything. It offers Docker on Linux, Docker Desktop on macOS, and WSL with Docker Desktop on Windows, where Windows may restart once and setup then resumes by itself. It starts Engaz, prints a private setup link, and opens it in your browser. On the installation machine, use `http://localhost:7791`; from another device on the same network, use the machine's IP, for example `http://192.168.1.20:7791`. It installs the `engaz` command. Run the same command again, or `engaz update`, to update. The [self-hosting guide](./docs/self-host.md#published-images-no-checkout) covers the options, including [keeping data in a folder you choose](./docs/self-host.md#keep-data-in-a-folder-you-choose).

## First run

1. **Create your account.** Open the installer's setup link to create the owner account. Keep its setup key private; other people join by invitation.
2. **Connect a model.** Engaz sends it one test request and tells you what went wrong before anything is saved. For a model server on the same computer, use `host.docker.internal` instead of `localhost`.
3. **Build your team.** Your first agent, Chief, is ready to chat. Give agents skills from their settings, and connect plugins under **Integrations → MCP servers**, where you choose which agents may use each tool.
4. **Invite people.** Others join with a link from **Settings → People**.

To reach Engaz away from home, follow [the Cloudflare Tunnel steps](./docs/self-host.md#reach-engaz-away-from-home-cloudflare-tunnel).

## Keep your data

An installation is its database, its app data, and the `.env` file holding its secrets; keep all three. Never run `docker compose down -v` on an installation you care about: it deletes the data. See the [secrets checklist](./docs/self-host-secrets.md). Use `engaz backup` before changing an installation. The [lifecycle and recovery guide](./docs/self-host.md#manage-an-image-installation) covers start, stop, updates, and restoring into a new empty folder. These commands ship in v0.1.7 and Linux recovery checks pass; representative NAS verification remains pending.

If you connect an external model or service, what you send it follows that provider's terms. See [privacy and data flow](./docs/privacy.md).

## About the project

Engaz builds on an Apache-2.0 licensed open-source project. Original copyright and attribution remain in [LICENSE](./LICENSE) and [NOTICE](./NOTICE). To run from source or help build it, see the [source setup](./docs/self-host.md#local-source-checkout) and [CONTRIBUTING.md](./CONTRIBUTING.md).
