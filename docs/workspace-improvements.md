# Workspace visibility and coordination

These source changes build on the existing agent, routine, artifact, memory, and computer interfaces. They are inspired by Bot HQ's workflow patterns; no external artwork was copied. They are not a published release.

## Work and files

Completed turns have a collapsed action count on web, desktop, and mobile. Expanding it shows persisted action labels, never raw arguments, results, private progress, or model reasoning. Details opens the existing recorded action and approval outcomes on web or the native activity-details screen. Historical duration is omitted because message history does not reliably record it. A count records actions attempted; it does not establish that each action succeeded.

Files opens from the web chat header or agent settings; mobile has a Files screen in Chat settings. It lists existing artifacts, including uploads, deliverables, and saved calls. Search, text preview, and download/share use the same access checks and storage as chat attachments. Text previews are bounded; other files use download or native sharing. Group files stay scoped to their group.

## Quiet briefings

An owner can opt a scheduled routine into only reporting new work needing attention. For Chief, this provides a short team briefing without another task system. The backend skips the model entirely when nothing changed, while other work is active, or during a recent conversation. Briefings receive a bounded snapshot of waiting work, parked tasks, and recent routine results, with total counts when examples are truncated. They receive no tools. A completed briefing supplies the next snapshot watermark; failed attempts do not consume attention.

Quiet briefings use schedules only. Normal app events, webhooks, GitHub, and messaging routines retain their ordinary execution and approval policies.

## App events

Composio can optionally supply outbound app-event subscriptions. A connected account and saved event bind a routine to one owner, provider account, and trigger. Before accepting a delivery, the database transaction locks the thread, routine, and connection in that order, rechecks access, and commits one idempotent message/run. Pause or revocation before acceptance rolls the tentative message back. Disabling a routine prevents new deliveries; already accepted work keeps its existing lifecycle.

Provider payloads are untrusted data. Transient acceptance errors retry with bounded backoff. Deleting a routine or agent cleans up unreferenced upstream triggers without preventing local cleanup. The connector remains optional: ordinary schedules and existing inbound trigger paths do not require it.

The outbound SDK path is experimental. It does not guarantee replay of events missed while the installation is offline. The installed SDK omits upstream delivery IDs, so identical payloads on one trigger share a replay identity. Use signed inbound webhooks when replay guarantees matter. Live Composio delivery is not established by offline emulator tests.

## Voice

The existing provider-neutral dictation, agent execution, and speech path remains available. With an OpenAI voice credential, web/desktop can additionally use live WebRTC audio through a short-lived session. Automatic realtime-model replies and tools are disabled: work and approvals still go through the selected agent's normal thread. The browser adapter contains no permanent provider credential. Disconnects fall back to the ordinary call, and protected-input requests mute recording.

Hangup saves a Markdown call artifact with an extractive summary and conversation transcript. Saves are idempotent per owner, agent, and call. Failed saves offer retry or download. A bounded transcript explicitly records truncation. Native live WebRTC is not implemented; mobile retains its existing voice path. Physical microphones and paid-provider audio remain separate acceptance checks.

## Forgetting memory

The memory editor exposes Forget with confirmation. It checks ownership and the displayed document revision, then deletes that Markdown memory and its revision history atomically. Web and mobile use the same API. It does not erase prior chat messages, backups, already-running prompts, or memories stored by optional external semantic providers. Those sources may still contain the information; this is document deletion, not an account-wide erasure claim.

## Computers

Bot HQ uses several screens on one Orgo computer. Engaz retains local Docker and optional remote providers, shared Team Computers, private computers, separate browser profiles, and watch/control capabilities. Shared screens and browser profiles are not hostile-agent filesystem isolation. Choose a private computer when work must not share a runtime.

The existing isolated Docker tests exercise simultaneous desktops, persistent browser profiles, and revocation when a display is reused. This change does not introduce a new computer provider or migrate installation data. Full control of the signed-in host desktop remains a separate roadmap item.

## Verification

Use the ordinary workspace checks and isolated harness:

- `pnpm db:generate`, `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- `pnpm test:integration`; `--spec=<substring>` selects an integration suite for diagnosis.
- Browser specs: `work-summary`, `files-library`, `knowledge-panel`, `voice`, `routine-briefing-events`, and the existing routine regression specs.
- The opt-in `team-desktops.docker.test.ts` checks real Linux browser/profile/viewer behavior without a hosted provider or native desktop windows.

Offline transport tests and emulator browser journeys do not establish live provider reliability or physical-device behavior. CI screenshots and current validation results belong on the pull request; installation, recovery, and release verification remain separate gates.
