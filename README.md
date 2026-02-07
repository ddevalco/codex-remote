# Codex Pocket

Remote control for your local Codex on your Mac from your iPhone.

This project started as a local-only fork of Zane (credit: https://github.com/z-siddiqi/zane):
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
- Your **Access Token** is printed by the installer and is also copied to your clipboard automatically (macOS `pbcopy`, best-effort).

What the installer does:
- Checks dependencies (git, bun, tailscale) and helps you install missing pieces.
- Builds the web UI (so you get a single self-contained local server + static UI).
- Writes state/config under `~/.codex-pocket/`.
- Attempts to install a `launchd` agent. If your system blocks `launchctl` (common on managed Macs), it will fall back to running in the background and prints `Service started via: ...`.
- Optionally configures `tailscale serve` so your iPhone can reach the service via MagicDNS.

## Enable iPhone Access (Tailscale)

If you do not have Tailscale yet:
1. Install Tailscale on Mac + iPhone and sign in
2. Run `tailscale up` on the Mac

Expose the service on your tailnet (run on Mac):

```bash
tailscale serve --bg http://127.0.0.1:8790
```

Then open on your Mac (to pair your iPhone):
- `http://127.0.0.1:8790/admin`
- generate a pairing QR and scan it with your iPhone

What to expect after pairing:
- Your iPhone will open `https://<your-mac-magicdns-host>/` and connect automatically (no manual “server URL” setup).
- Threads/models populate after the Anchor connects (usually a few seconds). If you see “No device connected”, check `/admin` and `~/.codex-pocket/anchor.log`.
- Existing threads may appear immediately, but some Codex versions do not replay full historical transcripts into third-party UIs. In that case, only new activity will show up. (We’re iterating on better backfill.)

Note about the Codex desktop app:
- Codex Pocket is its own UI. Messages you send from Codex Pocket may not immediately appear in the Codex desktop app UI without a refresh/restart of the desktop app.

## Developer Notes
- Local server: `services/local-orbit/src/index.ts`
- Anchor: `services/anchor/src/index.ts`

## Docs
- Install: `docs/INSTALL.md`
- Admin UI: `docs/ADMIN.md`
- CLI: `docs/CLI.md`
- Architecture: `docs/ARCHITECTURE.md`
- Security: `docs/SECURITY.md`
- Config: `docs/CONFIG.md`
- Security hardening: `docs/HARDENING.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`

## Attribution
See `docs/ATTRIBUTION.md`.
