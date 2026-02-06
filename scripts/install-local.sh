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

step "Expose via Tailscale (recommended)"
if confirm "Configure 'tailscale serve' for iPhone access now?"; then
  # Tailscale Serve CLI changed; prefer the new syntax.
  # We serve the local-orbit HTTP server; local-orbit handles UI + WebSockets on the same origin.
  "$TAILSCALE_BIN" serve --bg http://127.0.0.1:8790
  echo "Tailscale serve configured."
else
  echo "Skipping tailscale serve configuration."
fi

cat <<EON

To expose on your tailnet:

  tailscale serve --bg http://127.0.0.1:8790

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

step "Install CLI"
mkdir -p "$APP_DIR/bin"
cp "$APP_DIR/app/bin/codex-remote" "$APP_DIR/bin/codex-remote"
chmod +x "$APP_DIR/bin/codex-remote"

echo ""
echo "Add to PATH (zsh):"
echo "  echo 'export PATH=\"$APP_DIR/bin:$PATH\"' >> ~/.zshrc"
echo ""
echo "Then you can run:"
echo "  codex-remote doctor"
echo "  codex-remote status"

echo "Installed."
