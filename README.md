# Codex Remote

Remote control for your local Codex (on your Mac) from your iPhone over Tailscale.

This is a local-only fork of Zane:
- No Cloudflare
- No public internet exposure required
- Local persistence via SQLite

## What You Get
- Web UI (mobile-friendly): create tasks, watch live output, approve/deny writes, review diffs
- Admin UI (`/admin`): status, logs, start/stop Anchor, one-time pairing QR for your iPhone
- One local server (`local-orbit`) that serves:
  - UI (static)
  - WebSockets (`/ws`) for realtime control
  - REST endpoints for event replay (`/threads/:id/events`)

## Security Model
- You must be on the same Tailscale tailnet as the Mac.
- A single bearer token protects the WebSocket and admin API.
- Pairing: `/admin` can mint a short-lived one-time pairing code (shown as a QR).
  - Scan it on iPhone to store the bearer token locally.

## Install (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/ddevalco/codex-remote/main/scripts/install-local.sh | bash
```

After install:
- The service listens locally on `http://127.0.0.1:8790`.
- Your token is printed by the installer.

## Enable iPhone Access (Tailscale)

If you do not have Tailscale yet:
1. Install Tailscale on Mac + iPhone and sign in
2. Run `tailscale up` on the Mac

Expose the service on your tailnet (run on Mac):

```bash
tailscale serve https / http://127.0.0.1:8790
```

Then open on iPhone:
- `https://<your-mac-magicdns-host>/admin`
- Sign in once (token) or use the pairing QR

## Developer Notes
- Local server: `services/local-orbit/src/index.ts`
- Anchor: `services/anchor/src/index.ts`

