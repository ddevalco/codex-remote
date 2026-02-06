# Security

## Threat Model
- Unauthorized remote control of the local machine.
- Session hijacking or replay via leaked JWT or refresh token.
- Exposure of sensitive data in logs, prompts, or persisted events.
- Abuse of the Anchor local API (if reachable beyond localhost).

## Baseline Controls

### Authentication
- Users authenticate via WebAuthn passkeys.
- Auth service issues short-lived JWTs (1 hour) signed with `ZANE_WEB_JWT_SECRET` (issuer `zane-auth`, audience `zane-web`).
- Refresh tokens (7 days) are issued alongside access JWTs. Only the SHA-256 hash is stored server-side.
- Refresh token rotation: each refresh atomically revokes the old session and mints a new one, preventing replay.
- The client auto-refreshes the access JWT 60 seconds before expiry.
- `verifySession` checks the DB for `revoked_at` on every request, so server-side revocation is immediate.
- Multiple users can register via passkeys.

### Anchor Authentication
- Anchor authenticates via a device code flow (`/auth/device/code` → `/auth/device/authorise` → `/auth/device/token`).
- On successful device login, the auth service returns `ZANE_ANCHOR_JWT_SECRET` over HTTPS.
- Anchor stores credentials in `~/.zane/credentials.json` with `0600` permissions.
- Anchor mints short-lived JWTs (5 minutes) signed with `ZANE_ANCHOR_JWT_SECRET` (issuer `zane-anchor`, audience `zane-orbit-anchor`).
- Orbit validates both web and anchor token types based on audience and issuer.

### Transport
- HTTPS/WSS via Cloudflare (TLS).
- Anchor only opens outbound connections to Cloudflare.

### Anchor Hardening
- **BUG: The local HTTP API does not bind to `127.0.0.1`.** `Bun.serve()` has no `hostname` parameter, so it defaults to `0.0.0.0` (all interfaces).
- **BUG: The local WebSocket (`/ws/anchor`) has no authentication.** Any process that can reach the port can connect and send commands.

### Session Safety
- Three permission presets: Cautious (`on-request` + `read-only`), Standard (`on-request` + `workspace-write`), and Autonomous (`never` + `danger-full-access`).
- Standard is the default — risky actions require user approval.
- Autonomous mode disables all approval prompts.
- Approval requests are exposed to the client in real time.

### Logging & Persistence
- Orbit persists selected event types (turns, diffs, approvals, user input) to a D1 `events` table.
- Cloudflare Workers observability is enabled — `console.log` output goes to Cloudflare's logging infrastructure.
- No application-level secret redaction is implemented.
- Avoid sending environment variables or local file contents unless requested.

### Data Isolation
- Orbit creates one Durable Object per `userId` and filters persisted events by `user_id`.
- Push notification subscriptions (endpoint, keys) are stored per user in D1.

### Security Headers
- Static site: HSTS, `X-Frame-Options: DENY`, CSP with `frame-ancestors 'none'`, `Permissions-Policy` denying camera/mic/geo.
- API responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

### CORS
- Auth and Orbit validate origins against `PASSKEY_ORIGIN` / `ALLOWED_ORIGIN`.
- `localhost` and `127.0.0.1` are always allowed regardless of the configured origin.

## Known Limitations
- JWT and refresh token leakage on the client device (both stored in `localStorage`).
- JWTs sent in WebSocket query params may appear in server logs.
- Logs may contain sensitive info if the user requests it.
- No E2E encryption between client and Anchor (Cloudflare terminates TLS).
- `~/.zane/credentials.json` stores `ZANE_ANCHOR_JWT_SECRET` in plaintext.
- `ZANE_ANCHOR_JWT_SECRET` is transmitted over HTTPS during device login — a single long-lived secret that lets the Anchor mint JWTs indefinitely.
- No rate limiting on any endpoint (login, device code polls, refresh, WebSocket connections).
- CORS always-allow-localhost could be a concern on shared machines.
- Durable Object challenge store uses a single instance (`idFromName("default")`) for all concurrent auth operations.

## Planned Improvements
- Bind Anchor local API to `127.0.0.1` and add authentication to the local WebSocket.
- Implement secret redaction in logs and persisted events.
- Optional E2E encryption using per-session keys.
- Cloudflare Access policy for extra protection.
- Rate limiting on auth and WebSocket endpoints.
- Command allowlisting (sandbox modes exist but are delegated to Codex).

## Operational Guidance
- Rotate JWT secrets if any device is compromised.
- Call `/auth/logout` to revoke sessions server-side.
- Each user's Anchor connects with their own credentials. Do not share Anchor credentials across users.
- Protect `~/.zane/credentials.json` — it contains the Anchor JWT signing secret.
