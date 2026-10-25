# Agent reliability improvements

These changes extend Engaz's existing scheduler, Activity, skills and Docker supervisor. Pi remains the execution engine. No new hosted service, subscription or model account is required. The implementation was informed by [OpenBot's architecture and reviewed learning flow](https://github.com/CopilotKit/OpenBot/tree/46642d6c91daa663bccff673595f4e12a419a496/docs); no OpenBot code or Intelligence dependency was copied.

## Scheduled work

The routine editor shows the last successful scheduler reconciliation and whether it happened within the last 90 seconds. A heartbeat is written after work was scanned and queue reconciliation succeeded; a process merely being alive does not count. The worker normally reconciles every 30 seconds. An unavailable check means scheduling needs attention, not that a specific job failed.

Each new clock-triggered run records its exact scheduled time and routine generation. A unique database constraint and transactional claim prevent two wakeups from creating the same occurrence. Queue/setup retries do not increment failure counts. Only the winning terminal run transition records an outcome, in the same transaction as its event and any notice.

A first terminal failure posts one durable conversation notice. The second stays quiet. Three consecutive terminal failures pause the routine and post an explanation. A successful terminal run resets the streak. Overlapping runs are counted in the order their terminal transactions commit. A manual enable/pause, schedule change or stale-policy change starts a new generation and resets the streak; automatic pausing also fences earlier queued work. Completions from an older generation cannot pause or reset the new generation. Push delivery remains best effort under the existing notification preferences; the conversation notice is durable. Webhook/manual test runs and historical runs without occurrence metadata do not contribute to this scheduled-work streak.

New routines default to skipping occurrences more than one hour overdue. The editor exposes that choice. Existing routines retain overdue execution until the owner enables protection; the migration explicitly preserves that behavior. A skipped recurring occurrence advances to the next future time. A skipped one-time occurrence becomes inactive. Last skipped time is visible. The check also runs before a queued occurrence starts; already-started work and its retries keep their existing recovery behavior. Skips do not count as failures.

## Activity details

Open Details on an Activity row for recorded trigger, original source, account authority, routine and action decisions. New delegated runs preserve their original trigger, including unattended webhook approval and routine tool restrictions. Explicit human approvals/refusals record the answering user. Details are account/space scoped and return selected metadata, not tool arguments, results, credentials or model review prose.

Requested, awaiting approval, approved, attempted, tool completed, failed, refused and unknown states are distinct. A completed tool call does not by itself confirm a real-world outcome. Missing historical decision/provenance context is shown as unavailable rather than reconstructed. Delegated runs with an unresolved original trigger conservatively require explicit approval for side effects, including when an older allow rule exists. New recorded human-origin delegations retain their normal policy. The first 100 effects are shown with a truncation indication.

## Save a lesson

Use Save a lesson on a completed reply on web or desktop. Review the selected run's text evidence and configured model, optionally add corrections, then generate a draft. This explicit action sends the displayed bounded evidence to the existing model connection. Known credentials are redacted; tool payloads, asks and attachments are excluded. Truncated evidence is marked. A review key rejects changed evidence or model destinations between preview and generation.

The model receives no tools, memory or other agents. Its output is an unsaved new skill draft in the existing editor. Edit, discard, or explicitly Save and assign to this agent. Saving rechecks ordinary skill ownership and assignment rules. This first slice creates new skills; it does not overwrite existing skill revisions or taught demonstrations, so a concurrent editor cannot lose changes. Skills contain instructions only and never grant plugins or credentials. Mobile offers a web/desktop review fallback.

## Computer network restrictions

[Optional operator-owned restrictions](computer-network-policy.md) are a separate Docker-only capability. They cover shell and browser traffic in the computer; API-side plugins and model connections retain their own boundaries. Approved destinations are literal IP addresses, not domain names. Public-IP filtering cannot distinguish globally numbered owner/LAN services from internet services, so the original blanket local-access requirement is not complete in that mode. Use approved-IP or no-network mode for explicit grants. The platform matrix and fail-closed behavior are documented there.

## Migration and verification

The two additive migrations add scheduled-occurrence/generation/failure fields, scheduler health, original run provenance and action-decision metadata. They do not rewrite old run history, skill content, credentials, encryption keys or agent files. Back up an installation before applying release migrations using the existing lifecycle procedure. No live installation was migrated for this work.

Deterministic tests cover scheduler behavior, Activity isolation/outcome classification, provenance and lesson preview/approval. PostgreSQL tests cover concurrent occurrence claims/finalization, duplicate retries, re-enabling, successful streak reset and overdue work. Browser tests capture the changed web flows at desktop and narrow widths. Network enforcement additionally has an opt-in real Docker/Chromium test; mocks do not establish that boundary. Native-device QA and the network platform matrix remain separate acceptance gates.
