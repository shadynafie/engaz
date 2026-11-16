# Connections

**Status: implemented in source; release and live provider acceptance remain pending.**

Open the user menu, then **Settings → Connections**. Choose an available app and finish sign-in on the app's own page. A device sign-in shows a code and a link only when that provider needs them. The installation makes a read-only account request before showing **Connected**; this verifies the account, not every possible action.

Choose the agents that may use that account. A connection created in Settings starts with no agents. An in-chat **Connect for this agent** button explicitly grants the initiating agent access after verification, while retaining any other existing grants. Connections and grants belong to their account owner and space; inviting someone does not give them access to another person's connected accounts.

Reconnect starts a new sign-in on the same saved connection and clears its agent grants. Select the agents again after the account is verified. Old sign-in polling and old action approvals cannot attach to the replacement authorization. Normal token renewal preserves the authorization and grants. Disconnect removes the installation's credential and grants, and attempts supported remote revocation; remote revocation is provider-specific and is not guaranteed for every app.

## Current app actions

The initial direct app tools are read-only. They do not send messages, edit files, delete records, or manage repositories.

| App | Implemented actions | Access requested |
| --- | --- | --- |
| GitHub | Read the connected profile, list public repositories, list assigned issues visible to the token | `read:user`, `read:org`; no private-repository grant |
| Microsoft 365 | List recent mail previews, calendar events, and drive file metadata | `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read`, plus `offline_access` for renewal |
| Google Workspace | List Gmail message identifiers, read one message, list upcoming primary-calendar events, and list Drive file metadata | Identity, Gmail read-only, calendar events read-only, Drive metadata read-only |
| Slack | Search messages accessible to the signed-in user | User `search:read`; no bot scopes |
| Notion | Search page metadata available through the selected connection | Publisher registration must use read content capability; the user selects pages in Notion |
| Linear | List issues and their state | `read` |

Available actions appear in the connection's tool details. An account can pass its identity check while a later action is refused by the app's scopes or administrator policy. Unavailable apps are not presented as ready-to-connect cards. If no direct app is available, the page says so and retains Advanced connections.

## Where credentials and data go

GitHub and Microsoft use the installation's device flow. Google, Slack, Notion, and Linear use the optional first-party sign-in helper in [apps/connect](../apps/connect/README.md). The helper handles the registered OAuth redirect and token renewal; the installation verifies the account and sends ordinary app API requests directly to the provider. The helper does not execute agent actions or receive their business API results.

The helper is a credential-processing trust boundary. It receives authorization codes and tokens during sign-in and renewal. Its Durable Objects serialize exchanges. Encrypted sign-in material and renewal retry results have a ten-minute logical lifetime: an expiry check runs on every read, and alarms remove expired ciphertext. Alarm delivery can lag; expired records are not usable during that delay. Only the installation retains the durable credential and renewal capability. Provider credentials, device codes, claim secrets, and renewal capabilities stay out of browser DTOs and model prompts; a displayed device **user code** is the provider's deliberate exception.

The helper uses a separate random browser nonce and an installation-held claim secret, so the browser callback URL cannot retrieve the resulting tokens. Renewal and supported revocation require capabilities bound to the provider and token hashes. Callback responses disable caching and referrer forwarding; the helper source does not log codes, tokens, provider error bodies, or request bodies. Infrastructure callback/query logging must also remain disabled. See the [helper protocol and retention](../apps/connect/README.md#protocol-and-retention) for the exact boundary.

The installation encrypts account credentials in its database using the original installation secrets. Preserve the database, app data, and original `.env` together when backing up or restoring. A model receives allowed tool results as part of the task, according to the installation's model configuration; see [data and privacy](privacy.md).

Agent grants are checked at discovery and again before execution, including after a queued approval. Direct app routes are tied to their authorization generation. Legacy Pipedream routes pin the concrete signed-in account for both discovery and execution; an unknown or old slug-only account reference requires reconnecting rather than falling back to a provider-selected account.

## Advanced and existing connections

**Connections → Advanced** contains MCP servers, OpenAPI, GraphQL, and custom tool-source management. MCP transport, headers, tokens, and per-tool controls stay there. The owner-only local-network trust path and public-only protection for other callers remain in force.

Saved Composio and Pipedream accounts remain under **Saved connections** in Advanced. Existing grants are preserved by the migration; newly created accounts start unassigned. Their provider implementations and action approval rules continue to apply, so the read-only table above describes direct app tools, not every legacy or custom plugin. This change does not migrate credentials to a new provider or silently delete an existing account. Older `/integrations/setup` links open Settings → Connections.

Web and Electron use the same Settings panel. Mobile has a native Connections screen with the same ownership and agent-grant rules. Direct sign-in and grant management require an updated client; older native builds should use the installation's web Settings. The legacy API default remains compatible with older managed-connection callers. Physical-device sign-in and end-to-end provider acceptance remain separate checks.

## Publisher setup and remaining gates

End users sign in to their accounts; the ordinary connection flow does not ask them to create developer applications, choose an OAuth hosting vendor, or provide publisher client secrets. Registrations and provider review belong to the Engaz maintainer or the operator publishing a replacement helper.

The public site currently says Engaz does not offer a hosted service. Preparing this optional helper does not change that current statement or authorize its launch. Before launch, the publisher must approve and publish the helper's privacy disclosure, its support and publisher identity, and an accurate explanation that it processes account tokens during sign-in and renewal. Public messaging must be reconciled with the actual deployed service, and the same approved identity and disclosures must accompany provider registrations and verification. Do not invent a legal identity, support address, approved privacy policy, or provider approval to complete those forms.

The helper source is **not a deployed service**. Production configuration selects `https://connect.engaz.app` as the default helper origin, but that default is not evidence that the service is hosted or providers are registered. Apps are advertised only when the configured helper or native public client settings make them available. The core workspace and Advanced MCP/custom connections do not require the helper.

An operator can configure a separate HTTPS helper origin through the shared `DIRECT_APP_SETTINGS` JSON setting. `connectUrl` selects the helper; `githubClientId` and `microsoftClientId` are optional publisher-owned public application IDs. These are operator settings, not instructions for ordinary users to register apps. Setting `connectUrl` to an empty string disables helper use; explicit native public client IDs may still enable their device flows. Detailed private Worker configuration is in [the helper README](../apps/connect/README.md#configuration).

Before calling the direct app flow publicly ready, the maintainer must deploy and secure the helper, register the exact callback addresses and intended provider audience, obtain required provider verification or app review, and exercise real consent, account verification, API reads, expiry, renewal, revocation, and interrupted sign-in. These gates are open. No existing installation or live provider account is changed by this source work.

Offline coverage lives in the [direct connector tests](../packages/adapters/src/direct-app-connector.test.ts), [helper HTTP client tests](../packages/adapters/src/direct-app-broker.test.ts), [helper protocol tests](../apps/connect/src/index.test.ts), [Pipedream account tests](../packages/adapters/src/pipedream-connector.test.ts), [database-backed connection journeys](../packages/testkit/src/direct-connections.test.ts), and [Connections browser tests](../apps/web/e2e/connections.spec.ts). These fixtures do not establish live provider or production readiness. Release evidence belongs in the [roadmap](roadmap.md).
