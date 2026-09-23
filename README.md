# Engaz

Engaz is an open-source AI team workspace for solo founders and small businesses. Give each agent a role, connect the tools it needs, and keep work, approvals, and outcomes in one place.

This project is based on [Rakazo](https://github.com/elie222/rakazo), licensed under [Apache 2.0](./LICENSE). The existing agent runtime, API, web app, desktop app, and mobile app are the starting point. Engaz is in its foundation stage; the product experience and technical names inherited from Rakazo are being updated incrementally. This repository does not yet publish Engaz Docker images or a hosted service.

## Product direction

- Make an AI team understandable to someone running a small business alone.
- Show what each agent can access, what it is doing, and what needs approval.
- Make model, MCP, and API connections easy to set up and verify.
- Keep the core self-hostable and provider-neutral.

## Run from source

You need Node.js 22.22.2 or newer in the 22.x line, Node.js 24.x, or Node.js 26+, plus pnpm 9 and Docker. The current workspace still uses the inherited `@rakazo/*` package names and Compose configuration.

```bash
git clone https://github.com/shadynafie/engaz.git
cd engaz
cp .env.example .env
# Set POSTGRES_PASSWORD, DATABASE_URL, BETTER_AUTH_SECRET,
# ENCRYPTION_KEY, SCREEN_PROXY_SECRET, and SANDBOX_SUPERVISOR_TOKEN.
docker compose --env-file .env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.postgres-host.yml \
  up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

The [self-hosting guide](./docs/self-host.md) describes the inherited deployment in detail. Review its Rakazo image names and example domains before using it for Engaz; those references do not identify Engaz releases.

## Development

```bash
pnpm check
pnpm lint
pnpm test
```

The web app lives in `apps/web`, the API in `apps/api`, the worker in `apps/worker`, and shared contracts and adapters in `packages/`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the existing test matrix.
