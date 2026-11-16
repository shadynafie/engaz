# Connection sign-in helper

A Cloudflare Worker handles OAuth redirects and renewal for an Engaz installation. It never runs app actions or reads business data. The installation verifies the connected account and calls app APIs directly.

This is source for an optional sign-in helper, not a deployed service. Provider registrations, verification, app review and live provider acceptance remain required. GitHub and Microsoft use the installation's device flow; this helper may advertise their publisher-owned public client IDs.

## Configuration

### Prepared publisher identity

Use **Engaz** as the application name, `https://engaz.app` as the homepage, and `support@engaz.app` as the public support address. The Google publisher project is prepared; its consent screen and client credentials are not configured. Google requires the support address to be an eligible Google account or managed Google Group before it appears in the consent-screen selector. Do not substitute a private personal address.

| Registration | Publisher configuration |
| --- | --- |
| GitHub OAuth application | Enable device flow. Publish only its public client ID. The installation requests the scopes in the direct connector; no client secret is sent to installations. A registration callback is required by GitHub but is not used by the device flow. |
| Microsoft Entra application | Enable public-client device flow, support organizational and personal Microsoft accounts, and configure delegated read permissions listed in [Connections](../../docs/connections.md#current-app-actions). No client secret. Organization policies can still require administrator approval. |
| Google web application | External audience, exact Google callback below, read-only scopes from the provider table. Gmail access requires provider verification and may require a security assessment; a development test audience is not public readiness. |
| Slack application | OAuth v2 redirect below, user `search:read`, no bot scopes. Public distribution and applicable review must be enabled before advertising availability. |
| Notion public connection | OAuth redirect below, read content capability only, user-selected pages. |
| Linear OAuth application | OAuth redirect below, `read`, default user actor. |

Before creating credentials, review the registration audience, exact redirects, permissions, and public identity. Keep secrets in the publisher's private secret store. Complete provider review and real consent/renewal tests before adding that provider to the helper configuration. Publishing a client ID or a configured catalog entry is not evidence that a provider has approved the app.

Set a custom HTTPS route and `PUBLIC_ORIGIN` to that exact origin, without a path. Redirect addresses are built only from this value; request host headers cannot change them. Keep provider callback URLs registered exactly as:

```
https://<connection-origin>/oauth/callback/google
https://<connection-origin>/oauth/callback/slack
https://<connection-origin>/oauth/callback/notion
https://<connection-origin>/oauth/callback/linear
```

Supply `PROVIDERS` as a private Worker secret containing only configured providers and their publisher-owned client credentials. Empty `{}` disables every brokered provider. Do not commit actual values.

```json
{
  "google": { "clientId": "<publisher-client-id>", "clientSecret": "<publisher-client-secret>" }
}
```

`TOKEN_KEY` is a separate private secret: 32 cryptographically random bytes encoded as 64 hexadecimal characters or unpadded base64url. Keep it stable across releases; rotating it invalidates in-flight sign-ins and existing renewal capabilities, requiring those accounts to reconnect.

Optional `PUBLIC_CLIENTS` contains only `githubClientId` and `microsoftClientId`. These are public application identifiers, not client secrets. Do not enable a provider until its registration supports the intended sign-in flow and deployment audience.

The Wrangler configuration binds `SESSIONS` to the SQLite Durable Object class `ConnectSession`. Its migration creates that class. A Wrangler CLI is needed to publish it; deployment is an explicit publisher action. No CLI or hosted OAuth vendor is a runtime dependency.

## Anonymous admission limits

The required `AUTH_START_LIMITER` binding admits 20 authorization starts per minute per source. `TOKEN_REQUEST_LIMITER` admits 120 callback, claim, refresh and revocation requests per minute per source. Admission runs before session allocation or provider work; invalid refresh capabilities are also rejected before allocating their Durable Object. Denied traffic gets 429 with `Retry-After: 60`. Missing limiter bindings, limiter failures, or a missing Cloudflare edge address fail closed with 503.

These pre-authentication limits use a SHA-256 digest of Cloudflare's `CF-Connecting-IP` header, never caller-selected installation IDs, forwarded-address headers or credentials. No raw address is logged or stored by the helper. The helper must run behind the Cloudflare edge; do not expose a proxy that lets callers supply that trusted header. Source addresses can be shared by several legitimate installations, so publisher thresholds may need adjustment for shared networks.

The Worker bindings are approximate and local to each Cloudflare location; they are not a global spending or abuse ceiling. Before deployment reserve two distinct rate-limit namespace IDs in the publisher's Cloudflare account (the configuration's `1001` and `1002` are examples), verify the bindings on the actual route, and set edge abuse controls and billing alerts appropriate to the publisher's deployment. Keep these limits separate from unrelated Workers. See the [official Rate Limiting API documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Fixed provider access

| Provider | Requested access | Renewal/revocation |
| --- | --- | --- |
| Google Workspace | `openid email profile`, `gmail.readonly`, `calendar.events.readonly`, `drive.metadata.readonly` | Offline refresh; Google token revocation endpoint. Google revocation can invalidate other grants for the same OAuth project. |
| Slack | User `search:read`; no bot scopes | OAuth v2 user token, optional token rotation, `auth.revoke` for access-token revocation. |
| Notion | Pages selected in Notion consent; register the public connection with read content capability only | OAuth refresh when supplied. No remote revocation endpoint is claimed; the helper returns `revoked:false`. |
| Linear | `read` with the user's default actor | Rotating refresh tokens and the OAuth revocation endpoint. |

The request cannot choose token endpoints, redirect addresses or scopes. Only these provider endpoints receive provider credentials. Redirects and oversized provider responses are refused.

## Protocol and retention

- `GET /v1/catalog`: configured provider names and optional public native client IDs.
- `POST /v1/authorizations`: `{provider,state,installationId,claimChallenge}`. The NAS generates a random claim secret and sends its SHA-256 base64url challenge. The response contains a random session ID, authorization URL and expiry.
- `GET /oauth/callback/:provider`: provider redirect only. Its state contains the session ID and a separate random nonce. It never contains the NAS state or claim secret.
- `POST /v1/authorizations/:sessionId`: `{provider,state}` with the NAS claim secret in the Bearer header. Pending sign-in returns 202. Only a matching NAS state, provider and claim secret can retrieve credentials. The browser callback state grants no retrieval authority.
- `POST /v1/refresh`: `{provider,refreshToken,brokerCredential}`. The signed capability binds the helper origin, provider and token hashes. A rotating refresh returns a replacement capability.
- `POST /v1/revoke`: `{provider,accessToken,refreshToken?,brokerCredential}`. The capability must match the account's token hashes before a supported provider revocation is attempted.

Durable Objects serialize callback and refresh work. Temporary state and returned tokens use AES-GCM encryption with fresh nonces. Storage retains only ciphertext and an alarm timestamp. Sign-in sessions and refresh retry results expire after ten minutes; alarms delete expired ciphertext, and every read enforces expiry even if an alarm is delayed. A successful claim remains retryable within that window so a lost HTTP response does not strand the installation. If a worker restart interrupts a one-use authorization-code exchange, the user must start sign-in again.

The helper does not persist a long-term account database. Only the installation keeps the durable account credentials and renewal capability. The refresh capability is a credential and must be stored encrypted with those tokens.

Responses disable caching and referrer forwarding. This worker logs no codes, tokens, request bodies or provider error bodies, and its Wrangler observability setting disables request logs. Keep infrastructure request/query logging and third-party analytics disabled on the callback route.

## Validation

Run `pnpm --filter @engaz/connect check` and the root offline tests. The tests supply fake Durable Object storage and provider HTTP responses. They do not establish live provider registration, consent-screen review or production readiness.

Official protocol references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/), [Notion authorization](https://developers.notion.com/guides/authorization/overview), [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication), and [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
