# Engaz development roadmap

Updated: 2026-09-23. This is the delivery plan and status record for Engaz v1. Change a status only when the linked behavior has been checked; a merged PR alone does not prove a user journey works.

## Product goal

An enthusiast, solo founder, or small business can run one Engaz installation on a computer or NAS, keep its data in a chosen durable location, create the first owner account, connect a model, create AI agents, teach them skills, and grant each agent explicit access to plugins. The web app is primary. Desktop and mobile connect to the same installation. An owner-controlled HTTPS URL is optional; `engaz.app` is neither a prerequisite nor a claimed live service.

The existing orchestration, apps, and provider architecture are the foundation. Prefer improving these flows over replacing them. Multi-tenant SaaS, billing, and a plugin marketplace are outside v1.

## Current baseline

| Area | Verified now | Remaining gap |
| --- | --- | --- |
| Core product | Web, API, worker, Electron, Expo, agents, onboarding, model connections, and integrations exist. | The full first-run journey has not been verified on a fresh public image installation. |
| Images | Anonymous pulls of app, computer, and updater and a healthy installer startup pass on amd64 and arm64 CI runners after each main publish. | Upgrade, and startup on real NAS and desktop hosts, remain untested. |
| Setup | Source setup and an image installer exist. | The image installer requires Docker, Compose, curl, and OpenSSL; it does not install Docker or offer a durable host directory. |
| Data | Postgres and appdata are persisted in Compose volumes; source backup and restore instructions exist. | A portable backup and verified restore for the image installer are missing. A configuration directory alone is insufficient. |
| Ownership | First registration becomes deployment owner; onboarding connects a model and creates a first agent. | First registration wins by design; the installer binds to 127.0.0.1, so only the host can claim. Signup policy after the owner needs an explicit choice. |
| Plugins | Integrations, MCP, API-based adapters, and agent toggles exist. | Connection tests, clear health, narrow per-agent tool access, and a safe local MCP route need work. Current MCP assignment can grant all tools. |
| Skills | Shared skill catalog and bot-scoped taught skills exist; agent instructions can be edited under Advanced. | Their relationship and per-agent assignment are unclear to users. |
| UI | A shared monochrome token system and reusable web components exist. | Settings and integrations are separated, and key agent controls are hard to find. |
| Quality | Main CI, including Web E2E, passed on 2026-09-23 ([run](https://github.com/shadynafie/engaz/actions/runs/35888758429)); the nightly run no longer fails on missing report storage. | Keep it green. |

This baseline describes source and checks, not the safety of an existing installation. The current NAS trial is live data and is read-only for this roadmap. New work uses the repository and isolated test installations.

## Order of work

Current status: **0 verified; 1 in progress (1.1 and 1.2 verified; 1.3–1.4 planned, after phase 2); 2 in progress; 3–5 planned.** Phase 2 moved ahead of 1.3–1.4 so the first-run experience is right before lifecycle tooling. Each numbered task should be a small reviewable PR with the stated proof. Finish a phase gate before calling that phase shipped. Parallel design, security, and data reviews can run while implementation proceeds; keep file ownership distinct.

### 0. Restore the release gate

1. Diagnose the failing Web E2E golden test. Check whether aborted `/api/auth/capabilities` requests are expected navigation cancellation or a real auth failure; fix the root cause or make the assertion accurately distinguish them. Rerun the focused test, then full CI. **Verified:** a sign-up navigation raced the session refetch and briefly mounted sign-in; auth routes now redirect from session state ([PR #3](https://github.com/shadynafie/engaz/pull/3)).
2. Verify anonymous pulls of the app, computer, and updater images on amd64 and arm64 and boot an isolated stack from published images. Record image digests and startup outcome in the PR; do not substitute a manifest response for a pull. **Verified:** `published-image-boot` runs the documented installer with no registry credentials on native amd64 and arm64 runners and reached healthy web and API services ([PR #4](https://github.com/shadynafie/engaz/pull/4); app `sha256:7d0f50b8…`, computer `sha256:0c333a9d…`, updater `sha256:25955051…`). It reruns after every main image publish.
3. Keep the optional Playwright report publisher from turning a test failure into a second notification. The publishing workflow should skip cleanly when its report credentials are unavailable. **Verified:** the nightly run uses the `PLAYWRIGHT_REPORT_ENABLED` opt-in and skipped the upload in a dispatched run ([PR #5](https://github.com/shadynafie/engaz/pull/5)).

**Gate:** main CI green; fresh published-image startup confirmed on supported architectures; no claim that the installer is one command yet. **Met on 2026-09-23** ([main CI](https://github.com/shadynafie/engaz/actions/runs/35888758429)).

### 1. Make installation and recovery safe

1. Extend the image installer in `infra/compose/` to accept an absolute host data directory. Preflight Docker daemon and Compose compatibility, required ports, directory ownership/write access, and free space before writing data. Put Postgres data, shared app/agent data, and the original `.env` secrets under that directory. Test the supervisor's bot-home mounts as well as the web and API containers. **Verified:** `--data-dir` and its preflight checks; CI installs into a folder on amd64 and arm64, writes an agent-computer file, and keeps it across a stack recreate ([PR #6](https://github.com/shadynafie/engaz/pull/6)).
2. Offer the simplest supported Docker setup path. On explicitly supported Linux distributions, Docker installation may be opt-in with the exact commands shown first. On NAS, macOS, and Windows, provide clear prerequisite instructions when automatic installation is unsafe or unsupported. Never imply Docker was installed automatically until that path is tested. **Verified:** the one-command installer offers Docker's script (or pacman on Arch-based systems) after showing the command; CI installs Docker on fresh amd64 and arm64 Ubuntu runners and reaches a ready Engaz ([PR #8](https://github.com/shadynafie/engaz/pull/8)). The one-line command also installed Docker with pacman on an Arch Linux ARM virtual machine and reached sign-up. NAS and macOS hosts still need a manual run.
3. Provide `start`, `stop`, `status`, and `upgrade` instructions that retain data. Remove or clearly guard any user-facing path that runs `docker compose down -v`. Changing the Compose project name or moving from existing named volumes needs an explicit migration procedure; never silently create empty replacement volumes.
4. Provide portable backup and restore for the image installation. Capture a consistent database state, appdata, and original secrets; protect the archive and rehearse restoration into a clean isolated installation. Verify owner sign-in, an agent file, and a decrypted saved credential after restore.

**Gate:** a novice can choose a path, install, restart, recreate containers, and restore a backup without losing accounts, agents, files, or connections. Run this on clean amd64 and arm64 Linux hosts and one representative NAS layout. An existing Rakazo installation is migrated only through a separately tested procedure with rollback.

### 2. Secure first run and remote access

1. Show the Engaz brand from the first screen: browser tab, installable web app, sign-up page, and desktop and mobile app icons, all generated from one source. **Verified:** the generator writes every platform icon from the traced face; CI captured the sign-up page and the packaged macOS Dock icon ([PR #10](https://github.com/shadynafie/engaz/pull/10)).
2. Keep first registration as the owner claim: the installation is reachable only from its host until the owner exists. Make later registration and invitations an explicit owner choice, and let public access (step 4) start only after an owner exists, so a public endpoint never offers the owner claim.
3. Turn onboarding into a short path: owner account → one working model connection → first agent → first conversation. Optional plugins can be skipped and revisited. Show a real model connection failure before the user reaches a broken chat. **In progress:** a new connection now sends one test request and is saved only if the model answers; the setup screen names the reason (rejected key, unavailable model, no credit, unreachable server). Common providers are listed first, models are searchable, and the Docker installation can reach a model server on the same computer.
4. Keep local-only access as the default. For a user-owned public URL, document and validate HTTPS, reverse proxy, and matching auth, web, and API origins. Do not expose Postgres, the sandbox supervisor, or the Docker socket publicly. Desktop and mobile must let the user select their installation and recover from an invalid URL or certificate.

**Gate:** fresh-install tests prove public access cannot be enabled before an owner exists, the owner can finish first run, a second account follows the chosen signup policy, and local plus optional HTTPS access work across applicable clients.

### 3. Make settings and plugins usable

1. Give Settings and Plugins clear entry points from the main workspace and from an agent. Reuse the existing overlays and components. Preserve context when returning to a conversation; keep transport, headers, and API details under Advanced.
2. Give every saved plugin a truthful state: untested, connected, or needs attention, with last check and a retry. A saved credential is not a passed connection test. Cover auth, capability discovery, expired access, and unavailable services. **In progress:** MCP servers are checked when added, edited, or signed in to, and on demand. Each shows working (with its tools), sign in needed, or needs attention with the reason; agent runs update the same status. An unreachable server is not saved. OpenAPI and GraphQL sources still use their own check.
3. Show the exact tools or actions exposed by a plugin and which agents can use them. New assignments should start with narrow permissions; revocation takes effect immediately. Consequential writes follow approval policy, with visible activity history.
4. Add local MCP support through an explicitly local trust path. Retain the remote client's private-network SSRF protection. Test redirect, DNS rebinding, and private-host behavior at the boundary; do not make a general public URL field accept arbitrary LAN addresses.

**Gate:** a nontechnical owner connects one service, confirms it actually works, grants a chosen agent one named capability, sees an action, revokes access, and can diagnose a failed connection. Verify permissions at the API boundary, not only in UI state.

### 4. Make agent skills understandable

1. Define and document the existing shared skill catalog versus bot-scoped taught skills, including ownership, storage, and current execution behavior. Choose one user-facing assignment model without discarding existing data.
2. Put an agent's skills in its ordinary edit flow. Let the owner create or edit understandable instructions, preview what the agent will receive, attach or detach a skill, and see which agents use it. Keep raw `SKILL.md` editing in Advanced where needed.
3. Verify an agent follows an assigned skill, an unassigned agent does not receive it, edits propagate as intended, and removal does not corrupt past runs. Keep execution permissions separate from skill text.

**Gate:** the owner can teach a reusable workflow and deliberately give it to one agent using web, desktop, or an explicit safe mobile fallback.

### 5. Polish and release self-hosted v1

1. Apply the existing semantic tokens and monochrome components to changed screens. Test light/dark, keyboard access, narrow web widths, and native navigation. Bot identity color remains the only identity accent.
2. Verify the same installation with web, Electron, and Expo clients. Release desktop/mobile builds only after their server selection, sign-in, first conversation, plugin permission display, and error recovery are checked. Store listing or update delivery is a separate release gate, not implied by source code.
3. Make `README.md` the short public user guide and keep technical install, backup, restore, security, and troubleshooting steps in `docs/self-host.md`. Publish versioned images and a tested upgrade/rollback path before calling v1 ready.

**V1 release gate:** a fresh owner completes setup and first conversation on supported hosts; data survives restart, recreate, backup, restore, and upgrade; plugin and skill access is understandable and enforced; CI is green; the documented commands and published artifacts match the tested release.

## How to maintain this roadmap

- Mark each slice **planned**, **in progress**, or **verified** in its PR or linked issue; add the commit, test run, and user journey that prove verification. Do not convert a plan into a shipped claim because code merged.
- Start each PR with the smallest user outcome in the slice. Add deterministic offline checks for contracts, auth, permissions, and persistence; use isolated Docker smoke tests for installation and restore. Let CI run Electron E2E on a virtual display rather than opening windows on a maintainer's desktop.
- Review auth, secrets, backups, host commands, and MCP access with a separate security/data reviewer. For UI PRs, include the CI screenshot of the changed flow and quote any new visible copy with why it is needed.
- Preserve Apache-2.0 attribution. Never commit real credentials, installation data, private URLs, or personal details. The live trial is not a test environment.
