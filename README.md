# Codex Pocket

Remote control for your local Codex on your Mac from your iPhone.

This project started as a local-only fork of Zane (credit: https://github.com/z-siddiqi/zane):
- No Cloudflare
- No public internet exposure required
- Local persistence via SQLite

## How Codex Pocket Differs From Zane
Codex Pocket is a focused fork for a single use case: **run Codex locally on macOS and access it securely from iPhone over Tailscale**.

Key differences:
- **No Cloudflare dependency**: Codex Pocket uses a single local server (`local-orbit`) with a shared-token auth model.
- **Tailnet-first exposure**: binds to `127.0.0.1` and is designed to be exposed via `tailscale serve` to devices on your tailnet (no public internet required).
- **Simplified auth + pairing**: one bearer **Access Token** + short-lived one-time pairing QR in `/admin`.
- **Installer + lifecycle UX**: one-line installer, `launchd` integration (with background fallback), and a full `codex-pocket` CLI (`doctor/start/stop/restart/status/logs/pair/open-admin/update`).
- **Local persistence**: SQLite-backed event log + replay endpoints powering the Review UI.
- **iPhone-first usability**: default Enter = newline (send via Cmd/Ctrl+Enter), plus mobile-oriented UI fixes.
- **Concurrency**: composing in thread B while thread A runs now works (per-thread progress tracking).
- **Image uploads**: stored locally, served as capability URLs, configurable retention + cleanup from Admin.
- **Vision attachments**: uploaded images are now forwarded to Codex app-server as structured attachments (so vision-capable models can consume pixels), while still rendering inline in the chat UI.
- **Thread titles + rename sync**: Codex Pocket reads Codex Desktop's local thread title store so renamed titles show correctly, and can rename threads by updating the same store.

## What You Get
- Web UI (mobile-friendly): create tasks, watch live output, approve/deny writes, review diffs
- Image attachments: upload from iPhone, embed inline in threads
- Composer UX: Enter inserts newline by default (configurable per-device)
- Admin UI (`/admin`): status, logs, start/stop Anchor, one-time pairing QR for your iPhone
- One local server (`local-orbit`) that serves:
  - UI (static)
  - WebSockets (`/ws`) for realtime control
  - REST endpoints for event replay (`/threads/:id/events`)
  - Thread title enrichment (reads `~/.codex/.codex-global-state.json`)

## Demo

[![Codex Pocket demo](https://img.youtube.com/vi/kmH0hEY6Y7o/hqdefault.jpg)](https://www.youtube.com/watch?v=kmH0hEY6Y7o)

## Security Model
- You must be on the same Tailscale tailnet as the Mac.
- A single bearer token protects the WebSocket and admin API.
- Pairing: `/admin` can mint a short-lived one-time pairing code (shown as a QR).
  - Scan it on iPhone to store the bearer token locally.

## Uploads (Images)
- Uploads are stored locally on your Mac (default: `~/.codex-pocket/uploads`).
- Upload retention is **permanent by default** (`0` days). You can set retention (days) in `/admin`.
- Uploaded images are served via capability URLs (`/u/<token>`). This avoids putting your **Access Token** in image URLs and allows `<img>` tags to load on iPhone.


## Install (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/ddevalco/codex-pocket/main/scripts/install-local.sh | bash
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



## Wipe / Reset
If you want a clean slate (stop service, disable `tailscale serve`, remove launchd agent, delete `~/.codex-pocket`):

```bash
curl -fsSL https://raw.githubusercontent.com/ddevalco/codex-pocket/main/scripts/reset-and-install.sh | bash
```

If you only want to wipe without reinstalling, run the local script after install:

```bash
~/.codex-pocket/app/scripts/wipe-local.sh
```
## Enable iPhone Access (Tailscale)

If you do not have Tailscale yet:
1. Create a (free) Tailscale account: https://tailscale.com/
2. Install Tailscale on Mac + iPhone and sign in to both with the same account
3. Run `tailscale up` on the Mac

Terminology:
- A **tailnet** is your private Tailscale network (your account/org + its devices).
- **MagicDNS** is Tailscale's stable DNS name for your devices (e.g. `my-mac.tailXXXX.ts.net`).

Expose the service on your tailnet (run on Mac):

```bash
tailscale serve --bg http://127.0.0.1:8790
```

Note: Some tailnets require you to enable Tailscale Serve in the admin console the first time.
If you see an error like "Serve is not enabled on your tailnet", follow the link it prints and enable it.

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
- Protocol: `docs/PROTOCOL.md`
- Security hardening: `docs/HARDENING.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Changelog: `CHANGELOG.md`

## Attribution
See `docs/ATTRIBUTION.md`.
