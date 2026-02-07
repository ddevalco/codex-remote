# Install

## One-line install (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/ddevalco/codex-pocket/main/scripts/install-local.sh | bash
```

The installer:
- checks dependencies (git, bun, tailscale)
- offers to run `tailscale up` if needed
- clones/updates the repo into `~/.codex-pocket/app`
- installs dependencies
- builds the web UI
- writes config to `~/.codex-pocket/config.json`
- installs a `launchd` agent to run the service at login
- optionally configures `tailscale serve` so your iPhone can access it

Notes:
- The installer prints an **Access Token** and also copies it to your clipboard automatically (macOS `pbcopy`, best-effort).
- Some machines (often managed/MDM) block `launchctl load` with `error 5`. In that case Codex Pocket falls back to a background process (it will print `Service started via: background(pid ...)`).

## After install
- Local access: `http://127.0.0.1:8790`
- Tailnet access: `https://<your-mac-magicdns-host>/`
- Admin: `/admin`

## Uninstall
1. Stop and remove launchd agent:

```bash
launchctl unload "$HOME/Library/LaunchAgents/com.codex.pocket.plist" || true
rm -f "$HOME/Library/LaunchAgents/com.codex.pocket.plist"
```

2. Remove app data:

```bash
rm -rf "$HOME/.codex-pocket"
```
