# Engaz

**A self-hosted workspace for your AI team.** Create agents for different jobs, choose the models they use, teach them skills, and connect the services they need. Control which connections your agents can use.

Engaz is built for people who want to run their own installation on a computer or NAS. You can use it on your local network and, with your own HTTPS address, reach it while away. The web app is the main interface; desktop and mobile clients are also part of the project.

> **Current status:** Engaz is in its foundation stage. The simpler installer is not ready yet; the documented setup today is from source. Engaz does not offer a hosted service.

## Start here

1. **Set up your installation.** Follow the [self-hosting guide](./docs/self-host.md#local-source-checkout). It covers the required software, configuration, and startup steps. Docker, Node.js, and pnpm are needed for the current source setup. If you plan to make Engaz public, set the [signup and email policy](./docs/self-host.md#public-signup-policy) before the first start.
2. **Create your account.** Open the local address shown in the guide and register. The first account becomes the installation owner.
3. **Build your team.** Follow the in-app onboarding to connect a model and create your first agent. You can then teach agents skills and connect supported services through integrations, including MCP and API-based tools.

For access outside your network, configure HTTPS and matching application URLs using the [self-hosting guide](./docs/self-host.md#docker-compose-single-machine). The [mobile client guide](./docs/self-host.md#connect-mobile-clients) explains how to point the app at your installation. See the [desktop](./docs/desktop-release.md) and [mobile](./docs/mobile-release.md) guides for build and release instructions.

## Keep your installation safe

Your accounts, agents, and saved connections depend on application data and the original installation secrets. In the current source setup, Postgres uses a Docker volume and agent files live in `data/`. Back up both and `.env` together; see the [source backup](./docs/self-host.md#backup), [restore](./docs/self-host.md#restore), and [secrets checklist](./docs/self-host-secrets.md) before relying on Engaz for important work.

Engaz runs on hardware you control. If you connect an external model or service, data sent to it follows that provider's terms. See [privacy and data flow](./docs/privacy.md).

## About the project

Engaz builds on an Apache-2.0 licensed open-source project. Original copyright and attribution remain in [LICENSE](./LICENSE) and [NOTICE](./NOTICE). The current focus is a polished self-hosted experience; a multi-tenant hosted service is a possible later direction.

Want to help build it? See [CONTRIBUTING.md](./CONTRIBUTING.md).
