#!/usr/bin/env bash
set -euo pipefail

# Zane Local installer
# - Installs to ~/.zane-local/app (by default)
# - Builds the UI (Vite)
# - Creates a launchd agent to run the local server on login

APP_DIR="${ZANE_LOCAL_HOME:-$HOME/.zane-local}"
REPO_URL="${ZANE_LOCAL_REPO:-https://github.com/YOUR_ORG/zane-local.git}"
BRANCH="${ZANE_LOCAL_BRANCH:-main}"

bold=$'\033[1m'
reset=$'\033[0m'

abort() { echo "Error: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || abort "Missing dependency: $1"
}

step() { echo "${bold}$*${reset}"; }

step "Checking dependencies"
need_cmd git
need_cmd bun
need_cmd tailscale

if ! command -v codex >/dev/null 2>&1; then
  echo "Warning: codex CLI not found. Install it before using Anchor." >&2
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
(cd "$APP_DIR/app" && bun install)
(cd "$APP_DIR/app/services/anchor" && bun install)

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
(cd "$APP_DIR/app" && VITE_ZANE_LOCAL=1 bun run build)

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
PLIST="$LA_DIR/com.zane.local.plist"
mkdir -p "$LA_DIR"

step "Installing launchd agent to $PLIST"
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zane.local</string>
  <key>ProgramArguments</key>
  <array>
    <string>bun</string>
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

step "Optional: expose via Tailscale"
cat <<EON

To expose on your tailnet:

  tailscale serve https / http://127.0.0.1:8790
  tailscale serve https /ws http://127.0.0.1:8790/ws

Then open on iPhone:
  https://$(tailscale status --json 2>/dev/null | python3 - <<'PY'
import json,sys
try:
  d=json.load(sys.stdin)
  print(d.get('Self',{}).get('DNSName','<your-magicdns-host>'))
except Exception:
  print('<your-magicdns-host>')
PY
)

Token (save this):
  ${ZANE_LOCAL_TOKEN}

EON

echo "Installed."
