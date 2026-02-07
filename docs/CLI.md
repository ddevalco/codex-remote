# CLI

The `codex-pocket` CLI manages the service and calls the admin API.

## Commands

- `codex-pocket doctor`
  - Checks dependencies and service reachability.

- `codex-pocket start`
  - Starts the launchd agent (`com.codex.pocket`).

- `codex-pocket stop`
  - Stops the launchd agent.

- `codex-pocket status`
  - Prints `/admin/status` JSON.

- `codex-pocket logs [anchor]`
  - Prints `/admin/logs?service=anchor`.

- `codex-pocket pair`
  - Prints a one-time pairing URL (same as clicking "New pairing code" in `/admin`).

- `codex-pocket update`
  - Updates the installed app in `~/.codex-pocket/app` (git pull), rebuilds the UI, then restarts the service.

## Config

The CLI reads:
- `~/.codex-pocket/config.json`
