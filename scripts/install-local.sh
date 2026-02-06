#!/usr/bin/env bash
set -euo pipefail

# Codex Remote installer (local-only, Tailscale-first)
# - Installs to ~/.zane-local/app (by default)
# - Builds the UI (Vite)
# - Creates a launchd agent to run the local server on login

APP_DIR="${ZANE_LOCAL_HOME:-$HOME/.zane-local}"
REPO_URL="${ZANE_LOCAL_REPO:-https://github.com/ddevalco/codex-remote.git}"
BRANCH="${ZANE_LOCAL_BRANCH:-main}"

bold=$'\033[1m'
reset=$'\033[0m'

abort() { echo "Error: $*" >&2; exit 1; }

# Bun is often installed at ~/.bun/bin and may not be on PATH in non-interactive shells.
if [[ -d "$HOME/.bun/bin" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

resolve_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  if [[ -x "$HOME/.bun/bin/bun" ]]; then
    echo "$HOME/.bun/bin/bun"
    return 0
  fi
  if [[ -x "/opt/homebrew/bin/bun" ]]; then
    echo "/opt/homebrew/bin/bun"
    return 0
  fi
  return 1
}

resolve_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return 0
  fi
  if [[ -x "/opt/homebrew/bin/tailscale" ]]; then
    echo "/opt/homebrew/bin/tailscale"
    return 0
  fi
  if [[ -x "/usr/local/bin/tailscale" ]]; then
    echo "/usr/local/bin/tailscale"
    return 0
  fi
  if [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
    echo "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    return 0
  fi
  return 1
}

install_bun() {
  echo "Bun is required."
  if command -v brew >/dev/null 2>&1; then
    if confirm "Install Bun via Homebrew now?"; then
      brew install bun
      return 0
    fi
  fi
  if confirm "Install Bun via official installer now?"; then
    curl -fsSL https://bun.sh/install | bash
    if [[ -d "$HOME/.bun/bin" ]]; then
      export PATH="$HOME/.bun/bin:$PATH"
    fi
    return 0
  fi
  return 1
}

install_tailscale() {
  echo "Tailscale is required for iPhone access."
  if command -v brew >/dev/null 2>&1; then
    if confirm "Install Tailscale via Homebrew Cask now?"; then
      brew install --cask tailscale
      return 0
    fi
  fi
  echo "Install Tailscale from: https://tailscale.com/download" >&2
  return 1
}

offer_tailscale_path_hint() {
  # If the GUI app is installed, the CLI is often only inside the app bundle.
  if [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
    cat <<'EOT'

Note: Tailscale is installed, but the `tailscale` command may not be on your shell PATH.
You can run it directly as:

  /Applications/Tailscale.app/Contents/MacOS/Tailscale status

Optional: add it to your PATH (zsh):

  echo 'export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"' >> ~/.zshrc
  exec zsh
EOT
  fi
}

wait_for_local_orbit() {
  # Wait briefly for launchd to start the service.
  local url="http://127.0.0.1:8790/health"
  local i
  for i in {1..30}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || abort "Missing dependency: $1"
}

step() { echo "${bold}$*${reset}"; }

confirm() {
  local prompt="$1"
  printf "%s [Y/n] " "$prompt"
  read -r answer
  [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]
}

pause() {
  local prompt="${1:-Press Enter to continue...}"
  printf "%s" "$prompt"
  # shellcheck disable=SC2162
  read
}

need_cmd_or_prompt_install() {
  local cmd="$1"
  local install_hint="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  echo "Missing dependency: $cmd" >&2
  echo "$install_hint" >&2
  return 1
}

step "Checking dependencies"
need_cmd git

BUN_BIN="$(resolve_bun || true)"
if [[ -z "${BUN_BIN:-}" ]]; then
  if ! install_bun; then
    echo "Missing dependency: bun" >&2
    echo "Install Bun first: https://bun.sh" >&2
    exit 1
  fi
  BUN_BIN="$(resolve_bun || true)"
  if [[ -z "${BUN_BIN:-}" ]]; then
    echo "bun installation did not put bun on PATH." >&2
    echo "Try opening a new terminal and re-running the installer." >&2
    exit 1
  fi
fi

TAILSCALE_BIN="$(resolve_tailscale || true)"
if [[ -z "${TAILSCALE_BIN:-}" ]]; then
  if ! install_tailscale; then
    echo "Missing dependency: tailscale" >&2
    echo "Install Tailscale first: https://tailscale.com/download" >&2
    exit 1
  fi
  TAILSCALE_BIN="$(resolve_tailscale || true)"
  if [[ -z "${TAILSCALE_BIN:-}" ]]; then
    echo "tailscale installation did not put tailscale on PATH." >&2
    echo "Try opening a new terminal and re-running the installer." >&2
    exit 1
  fi
fi

offer_tailscale_path_hint

if ! command -v codex >/dev/null 2>&1; then
  echo "Warning: codex CLI not found. Install it before using Anchor." >&2
fi

step "Checking Tailscale state"
if "$TAILSCALE_BIN" status >/dev/null 2>&1; then
  echo "Tailscale: running"
else
  echo "Tailscale does not appear to be running or logged in."
  if confirm "Run 'tailscale up' now?"; then
    "$TAILSCALE_BIN" up
  else
    cat <<'EOT' >&2
You can still use Codex Remote locally at http://127.0.0.1:8790 once installed,
but iPhone access requires Tailscale.
EOT
  fi
fi

mkdir -p "$APP_DIR"

step "Installing app to $APP_DIR/app"
if [[ -d "$APP_DIR/app/.git" ]]; then
  git -C "$APP_DIR/app" fetch --quiet
  git -C "$APP_DIR/app" checkout "$BRANCH" --quiet
  git -C "$APP_DIR/app" pull --rebase --quiet
else
  rm -rf "$APP_DIR/app"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR/app"
fi

step "Installing dependencies"
(cd "$APP_DIR/app" && "$BUN_BIN" install)
(cd "$APP_DIR/app/services/anchor" && "$BUN_BIN" install)

step "Generating access token"
if [[ -z "${ZANE_LOCAL_TOKEN:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    ZANE_LOCAL_TOKEN="$(openssl rand -hex 32)"
  else
    ZANE_LOCAL_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  fi
fi

step "Building UI"
(cd "$APP_DIR/app" && VITE_ZANE_LOCAL=1 "$BUN_BIN" run build)

CONFIG_JSON="$APP_DIR/config.json"
DB_PATH="$APP_DIR/zane.db"
ANCHOR_LOG="$APP_DIR/anchor.log"

step "Writing config to $CONFIG_JSON"
cat > "$CONFIG_JSON" <<JSON
{
  "token": "${ZANE_LOCAL_TOKEN}",
  "host": "127.0.0.1",
  "port": 8790,
  "db": "${DB_PATH}",
  "retentionDays": 14,
  "uiDist": "${APP_DIR}/app/dist",
  "anchor": {
    "cwd": "${APP_DIR}/app/services/anchor",
    "host": "127.0.0.1",
    "port": 8788,
    "log": "${ANCHOR_LOG}"
  }
}
JSON
chmod 600 "$CONFIG_JSON" || true

LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/com.codex.remote.plist"
mkdir -p "$LA_DIR"

step "Installing launchd agent to $PLIST"
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.codex.remote</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BUN_BIN}</string>
    <string>run</string>
    <string>${APP_DIR}/app/services/local-orbit/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}/app</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ZANE_LOCAL_TOKEN</key>
    <string>${ZANE_LOCAL_TOKEN}</string>
    <key>ZANE_LOCAL_HOST</key>
    <string>127.0.0.1</string>
    <key>ZANE_LOCAL_PORT</key>
    <string>8790</string>
    <key>ZANE_LOCAL_DB</key>
    <string>${DB_PATH}</string>
    <key>ZANE_LOCAL_RETENTION_DAYS</key>
    <string>14</string>
    <key>ZANE_LOCAL_UI_DIST_DIR</key>
    <string>${APP_DIR}/app/dist</string>
    <key>ZANE_LOCAL_ANCHOR_CWD</key>
    <string>${APP_DIR}/app/services/anchor</string>
    <key>ZANE_LOCAL_ANCHOR_LOG</key>
    <string>${ANCHOR_LOG}</string>
    <key>ANCHOR_HOST</key>
    <string>127.0.0.1</string>
    <key>ANCHOR_PORT</key>
    <string>8788</string>
    <key>ZANE_LOCAL_AUTOSTART_ANCHOR</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${APP_DIR}/server.log</string>
  <key>StandardErrorPath</key>
  <string>${APP_DIR}/server.log</string>
</dict>
</plist>
PLISTXML

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

step "Waiting for service to start"
if wait_for_local_orbit; then
  echo "Service: running"
else
  echo "Warning: service did not become healthy at http://127.0.0.1:8790/health" >&2
  echo "Check logs: $APP_DIR/server.log" >&2
fi

step "Expose via Tailscale (recommended)"
if confirm "Configure 'tailscale serve' for iPhone access now?"; then
  serve_out="$("$TAILSCALE_BIN" serve --bg http://127.0.0.1:8790 2>&1)" || true
  if echo "$serve_out" | grep -qi "Serve is not enabled on your tailnet"; then
    echo "$serve_out" >&2
    echo "" >&2
    pause "After enabling Serve (see link above), press Enter to retry..."
    serve_out="$("$TAILSCALE_BIN" serve --bg http://127.0.0.1:8790 2>&1)" || true
  fi

  if echo "$serve_out" | grep -qi "Available within your tailnet"; then
    echo "Tailscale serve configured."
  else
    echo "$serve_out" >&2
    echo "Warning: tailscale serve may not be configured. You can retry later with:" >&2
    echo "  $TAILSCALE_BIN serve --bg http://127.0.0.1:8790" >&2
  fi
else
  echo "Skipping tailscale serve configuration."
fi

cat <<EON

To expose on your tailnet:

  $TAILSCALE_BIN serve --bg http://127.0.0.1:8790

Then open on iPhone:
  https://$("$TAILSCALE_BIN" status --json 2>/dev/null | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  name=d.get("Self",{}).get("DNSName","<your-magicdns-host>")
  # Tailscale typically includes a trailing dot.
  print(name[:-1] if isinstance(name,str) and name.endswith(".") else name)
except Exception:
  print("<your-magicdns-host>")')

Token (save this):
  ${ZANE_LOCAL_TOKEN}

EON

step "Install CLI"
mkdir -p "$APP_DIR/bin"
cp "$APP_DIR/app/bin/codex-remote" "$APP_DIR/bin/codex-remote"
chmod +x "$APP_DIR/bin/codex-remote"

echo ""
step "Summary"
echo "Install dir:      $APP_DIR/app"
echo "Config:           $CONFIG_JSON"
echo "Local URL:        http://127.0.0.1:8790"
echo "Admin URL:        http://127.0.0.1:8790/admin"
echo "Token:            $ZANE_LOCAL_TOKEN"
echo "Launchd agent:    $PLIST"
echo "Logs:             $APP_DIR/server.log"
echo "Anchor logs:      $ANCHOR_LOG"

if "$TAILSCALE_BIN" status >/dev/null 2>&1; then
  dns_name="$("$TAILSCALE_BIN" status --json 2>/dev/null | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  name=d.get("Self",{}).get("DNSName","")
  print(name[:-1] if isinstance(name,str) and name.endswith(".") else name)
except Exception:
  print("")')"
  if [[ -n "${dns_name:-}" ]]; then
    echo "Tailnet URL:      https://$dns_name/"
    echo "Tailnet Admin:    https://$dns_name/admin"
    if curl -fsS "https://$dns_name/health" >/dev/null 2>&1; then
      echo "Tailnet check:    ok"
    else
      echo "Tailnet check:    failed (you can still use Local URL)."
    fi
  fi
fi

echo ""
echo "Add to PATH (zsh):"
echo "  echo 'export PATH=\"$APP_DIR/bin:$PATH\"' >> ~/.zshrc"
echo ""
echo "Then you can run:"
echo "  codex-remote doctor"
echo "  codex-remote status"

echo "Installed."

echo ""
if confirm "Open the Admin page now (to pair your iPhone)?"; then
  open "http://127.0.0.1:8790/admin" >/dev/null 2>&1 || true
fi
