# Auth Overview

This app uses passkeys for user authentication and JWTs for service-to-service auth.

## Components

- Web client (Svelte)
- Auth service (Cloudflare Worker) for passkey registration/login
- Orbit (Cloudflare Worker + Durable Object) for WS relay and event storage
- Anchor (local Bun service) bridging Orbit to `codex app-server`

## JWTs and secrets

Two separate secrets are used:

- `ZANE_WEB_JWT_SECRET` signs **user session** JWTs (issuer `zane-auth`, audience `zane-web`)
- `ZANE_ANCHOR_JWT_SECRET` signs **Anchor** service JWTs (issuer `zane-anchor`, audience `zane-orbit-anchor`)

Orbit accepts either token depending on audience/issuer.

User JWTs are also stored server-side in `auth_sessions` for revocation and expiry checks.

## Request flows

### Passkey login

1) Web client calls Auth service endpoints to register or sign in:
   - `POST /auth/register/options` + `POST /auth/register/verify`
   - `POST /auth/login/options` + `POST /auth/login/verify`
2) Auth service returns a JWT and a refresh token, both signed with `ZANE_WEB_JWT_SECRET`.
3) Client stores both tokens in `localStorage`.
4) Auth service stores the session id (`jti`) in D1.
5) When the JWT expires, the client calls `POST /auth/refresh` with the refresh token to get a new JWT and rotated refresh token.

### Device code login (Anchor CLI)

1) Anchor requests a device code via `POST /auth/device/code`.
2) A user code is displayed in the terminal and a browser opens.
3) User enters the code on the web client, which calls `POST /auth/device/authorise`.
4) Anchor polls `POST /auth/device/token` until authorised, then receives a JWT.
5) Credentials are saved to `ZANE_CREDENTIALS_FILE` (default: `~/.zane/credentials.json`).

### Web client to Orbit

1) Client connects to Orbit WS using:
   - `wss://.../ws/client?token=<jwt>`
2) Client fetches events with:
   - `Authorization: Bearer <jwt>` to `GET /threads/:id/events`
3) Orbit verifies the JWT (issuer `zane-auth`, audience `zane-web`).

### Anchor to Orbit

1) Anchor mints a short-lived JWT using `ZANE_ANCHOR_JWT_SECRET`.
2) Anchor connects to:
   - `wss://.../ws/anchor?token=<jwt>`
3) Orbit verifies the JWT (issuer `zane-anchor`, audience `zane-orbit-anchor`).

### Anchor to app-server

1) Anchor spawns `codex app-server`.
2) Anchor sends an `initialize` JSON-RPC request with:
   - `cwd` (from `ANCHOR_APP_CWD`)
   - `clientInfo`

## Required configuration

Auth service:
- `PASSKEY_ORIGIN`
- `ZANE_WEB_JWT_SECRET`

Orbit:
- `ZANE_WEB_JWT_SECRET`
- `ZANE_ANCHOR_JWT_SECRET` (required if Anchor connects remotely)

Anchor:
- `ZANE_ANCHOR_JWT_SECRET`
- `ANCHOR_ORBIT_URL`
- `ANCHOR_APP_CWD` (optional, defaults to `process.cwd()`)

Client:
- `VITE_AUTH_URL`

## Common issues

- `Auth service unavailable` in the client: `PASSKEY_ORIGIN` does not match your web origin.
- `401` from Orbit WS/events: mismatched or missing JWT secret.
- `Not initialized` JSON-RPC errors: app-server did not receive `initialize` or rejected params.
- Wrong project files: `ANCHOR_APP_CWD` set to the wrong path.

## Security notes

- JWTs are sent in WS query params for browser compatibility; they may appear in logs.
- User JWTs live in `localStorage` and last 7 days; server-side revocation requires calling `/auth/logout`.
- Multiple users can register. The first user sees a streamlined setup screen; subsequent users see the normal login/register page.
