# Admin UI

Open `/admin` in the browser.

## What it shows
- Service status (UI dist, DB path/retention, anchor status)
- Anchor log stream

## Pair iPhone
- On first sign-in, `/admin` auto-generates a short-lived pairing QR.
- Use "Regenerate pairing code" to mint a fresh QR (codes are one-time and expire).
- Scan from iPhone to sign in without manually typing the token.

## Anchor control
- **Anchor** is the local agent running on your Mac. It spawns `codex app-server` and relays messages to the web UI.
- Anchor is auto-started by default when the service starts.
- Use "Stop anchor" if you want to suspend Codex spawning and remote control temporarily.

## SQLite persistence
- local-orbit stores selected events in SQLite (default `~/.codex-pocket/codex-pocket.db`).
- Retention is configured via `ZANE_LOCAL_RETENTION_DAYS` (default 14 days).
