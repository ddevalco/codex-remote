# Changelog

All notable changes to **Codex Pocket** will be documented here.

This project started as a local-only fork inspired by **Zane** by Z. Siddiqi (see `/Users/danedevalcourt/iPhoneApp/codex-pocket/docs/ATTRIBUTION.md`).

## Unreleased

### Ops / Self-Heal
- Admin now includes **Validate** and **Repair** buttons to run server-side health checks and apply safe repairs.
- CLI: added `codex-pocket ensure` (restart if needed, validate, repair, re-validate).
- CLI: added `codex-pocket smoke-test` for a fast PASS/FAIL check against `/health`, `/admin/validate`, and `/admin/status`.
- Repair now attempts to automatically configure `tailscale serve` (best-effort; may require enabling Serve in the Tailscale admin console).
- CLI: fixed `codex-pocket update` so its fallback start no longer breaks on shell/Python quoting issues; fallback now starts local-orbit using `ZANE_LOCAL_CONFIG_JSON` only. (commit `bd9fe0d`)
- CLI: `codex-pocket update` now runs `ensure` automatically after updating so users immediately get validation output.

### Thread List UX
- Threads are now sorted by most recently active (based on activity observed while Pocket is connected).
- Added a small active indicator for threads currently working (turn status InProgress).

### Docs
- Added first-time setup checklist + "Why Tailscale" and common first-run issues in `README.md`.

## 2026-02-07

### Thread Titles / Rename Sync
- Thread list titles now match Codex Desktop renamed titles by reading `~/.codex/.codex-global-state.json` and injecting `title/name/displayName` into `thread/list` + `thread/get` payloads. (commits `74db0ba`, `93c2702`)
- Added a thread rename action in Codex Pocket that updates Codex Desktop's title store (Admin token required). (commit `133d3da`)

### Vision / Attachments
- **Vision attachments**: image uploads are now passed to Codex app-server as structured `input` items (in addition to rendering inline in the UI). This makes attached images available to vision-capable models. (commit `5d58e60`)
- Uploads API now returns `localPath`, `filename`, and `mime` (authorised only) to support attachment wiring. (commit `5d58e60`)

### Branding
- Replaced the legacy Zane favicon with a Codex Pocket icon (`/icons/icon.svg`). (commit `01ba786`)

### iOS Upload UX
- iOS Safari now shows the Photo Library picker for attachments by removing the `capture` attribute that forced camera-only. (commit `dc14c32`)

### Admin: Upload Retention & Ops
- Admin UI now includes an Uploads section for retention config + manual prune, with status refresh after actions. (commits `e0247e1`, `a02f3eb`)

### Concurrency
- Fixed a global “turn in progress” state that blocked composing in other threads while one thread was running. Thread input is now tracked per-thread. (commit `e58cdd6`)

### CLI / Lifecycle
- Added `codex-pocket update`: pulls latest app, installs deps, rebuilds UI, restarts service (and updates the CLI copy). (commit `a2b4450`)
- Improved `start/stop/restart` reliability: auto-kill stale Codex Pocket listeners, wait for `/health`, and handle common port conflict cases. (commits `27aa998`, `6d2c959`)

### Installer UX & Reliability
- Installer improved to handle port conflicts more safely and persist port changes across config + launchd. (commit `a02f3eb`)
- Installer copies the access token to clipboard (best effort). (commit `defd262`)
- Pairing: QR served as an authenticated blob so the token doesn’t appear in image URLs. (commit `f462238`)
