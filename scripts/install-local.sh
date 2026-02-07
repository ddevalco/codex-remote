#!/usr/bin/env bash
set -euo pipefail

# Codex Pocket installer (macOS + iPhone, local-only, Tailscale-first)
# - Installs to ~/.codex-pocket/app (by default)
# - Builds the UI (Vite)
# - Creates a launchd agent to run the local server on login

APP_DIR="${CODEX_POCKET_HOME:-$HOME/.codex-pocket}"
REPO_URL="${CODEX_POCKET_REPO:-https://github.com/ddevalco/codex-remote.git}"
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
  local url="http://127.0.0.1:${LOCAL_PORT}/health"
  local i
  for i in {1..30}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_for_admin_auth() {
  # Verify admin API works (auth token accepted) before telling the user we're ready.
  local url="http://127.0.0.1:${LOCAL_PORT}/admin/status"
  local i
  for i in {1..30}; do
    if curl -fsS -H "Authorization: Bearer ${ZANE_LOCAL_TOKEN}" "$url" >/dev/null 2>&1; then
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

# Default ports (may be auto-adjusted if in use)
LOCAL_PORT="${ZANE_LOCAL_PORT:-8790}"
ANCHOR_PORT="${ZANE_LOCAL_ANCHOR_PORT:-8788}"

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
You can still use Codex Pocket locally at http://127.0.0.1:8790 once installed,
but iPhone access requires Tailscale.
EOT
  fi
fi

# Prefer generating pairing URLs that work from iPhone (MagicDNS over Tailscale).
MAGICDNS_HOST=""
PUBLIC_ORIGIN=""
if "$TAILSCALE_BIN" status >/dev/null 2>&1; then
  MAGICDNS_HOST="$("$TAILSCALE_BIN" status --json 2>/dev/null | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  name=d.get("Self",{}).get("DNSName","")
  # Tailscale typically includes a trailing dot.
  print(name[:-1] if isinstance(name,str) and name.endswith(".") else name)
except Exception:
  print("")')"
  if [[ -n "${MAGICDNS_HOST:-}" ]]; then
    PUBLIC_ORIGIN="https://${MAGICDNS_HOST}"
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

# Print the installed commit for debugging/support.
APP_COMMIT="$(git -C "$APP_DIR/app" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
echo "App commit: $APP_COMMIT"

# Sanity check: ensure we didn't accidentally install an old Anchor that binds a local port and requires AUTH_URL.
if ! rg -q "canDeviceLogin" "$APP_DIR/app/services/anchor/src/index.ts" 2>/dev/null; then
  echo "Error: installed Anchor source does not match expected version (missing canDeviceLogin)." >&2
  echo "This usually means you installed from an outdated repo/branch, or the clone failed." >&2
  echo "Repo:   $REPO_URL" >&2
  echo "Branch: $BRANCH" >&2
  echo "Commit: $APP_COMMIT" >&2
  exit 1
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

# Convenience: copy token to clipboard on macOS (best-effort).
if command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "$ZANE_LOCAL_TOKEN" | pbcopy >/dev/null 2>&1 || true
fi

step "Building UI"
(cd "$APP_DIR/app" && VITE_ZANE_LOCAL=1 "$BUN_BIN" run build)

CONFIG_JSON="$APP_DIR/config.json"
DB_PATH="$APP_DIR/codex-pocket.db"
ANCHOR_LOG="$APP_DIR/anchor.log"

step "Writing config to $CONFIG_JSON"
cat > "$CONFIG_JSON" <<JSON
{
  "token": "${ZANE_LOCAL_TOKEN}",
  "host": "127.0.0.1",
  "port": ${LOCAL_PORT},
  "db": "${DB_PATH}",
  "publicOrigin": "${PUBLIC_ORIGIN}",
  "retentionDays": 14,
  "uiDist": "${APP_DIR}/app/dist",
  "anchor": {
    "cwd": "${APP_DIR}/app/services/anchor",
    "host": "127.0.0.1",
    "port": ${ANCHOR_PORT},
    "log": "${ANCHOR_LOG}"
  }
}
JSON
chmod 600 "$CONFIG_JSON" || true

LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/com.codex.pocket.plist"
PID_FILE="$APP_DIR/server.pid"
STARTED_VIA="unknown"
mkdir -p "$LA_DIR"

start_background() {
  # Fallback when launchctl is blocked (some environments/MDM policies).
  rm -f "$PID_FILE" >/dev/null 2>&1 || true
  touch "$APP_DIR/server.log" >/dev/null 2>&1 || true
  nohup env \
    ZANE_LOCAL_TOKEN="$ZANE_LOCAL_TOKEN" \
    ZANE_LOCAL_HOST="127.0.0.1" \
    ZANE_LOCAL_PORT="${LOCAL_PORT}" \
    ZANE_LOCAL_DB="$DB_PATH" \
    ZANE_LOCAL_PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
    ZANE_LOCAL_RETENTION_DAYS="14" \
    ZANE_LOCAL_UI_DIST_DIR="$APP_DIR/app/dist" \
    ZANE_LOCAL_ANCHOR_CWD="$APP_DIR/app/services/anchor" \
    ZANE_LOCAL_ANCHOR_LOG="$ANCHOR_LOG" \
    ZANE_LOCAL_ANCHOR_CMD="$BUN_BIN" \
    ANCHOR_HOST="127.0.0.1" \
    ANCHOR_PORT="${ANCHOR_PORT}" \
    ZANE_LOCAL_AUTOSTART_ANCHOR="1" \
    "$BUN_BIN" run "$APP_DIR/app/services/local-orbit/src/index.ts" >>"$APP_DIR/server.log" 2>&1 &
  echo $! >"$PID_FILE"
  STARTED_VIA="background(pid $(cat "$PID_FILE" 2>/dev/null || echo "?"))"
}

step "Installing launchd agent to $PLIST"
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.codex.pocket</string>
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
  <string>${LOCAL_PORT}</string>
  <key>ZANE_LOCAL_DB</key>
  <string>${DB_PATH}</string>
  <key>ZANE_LOCAL_PUBLIC_ORIGIN</key>
  <string>${PUBLIC_ORIGIN}</string>
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
  <string>${ANCHOR_PORT}</string>
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

step "Stopping any existing Codex Pocket service"
# Try to stop a prior install cleanly to avoid EADDRINUSE on port 8790.
launchctl unload "$PLIST" >/dev/null 2>&1 || true
if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]]; then
    kill "$old_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE" >/dev/null 2>&1 || true
fi
# Safety net: only kill processes that match our script path.
pkill -f "$APP_DIR/app/services/local-orbit/src/index.ts" >/dev/null 2>&1 || true
pkill -f "$APP_DIR/app/services/anchor/src/index.ts" >/dev/null 2>&1 || true

# Final safety net: kill anything still listening on our ports.
if command -v lsof >/dev/null 2>&1; then
  for p in "$LOCAL_PORT" "$ANCHOR_PORT"; do
    lpids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${lpids:-}" ]]; then
      # shellcheck disable=SC2086
      kill $lpids >/dev/null 2>&1 || true
    fi
  done
fi

find_free_port() {
  local start="$1"
  local end="$2"
  local p
  for p in $(seq "$start" "$end"); do
    if ! lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | head -n 1 | rg -q .; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

# If something else is listening on LOCAL_PORT, offer options.
if command -v lsof >/dev/null 2>&1; then
  listener_pid="$(lsof -nP -t -iTCP:${LOCAL_PORT} -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${listener_pid:-}" ]]; then
    listener_line="$(lsof -nP -iTCP:${LOCAL_PORT} -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1 || true)"
    echo "" >&2
    echo "Port ${LOCAL_PORT} is already in use:" >&2
    echo "  $listener_line" >&2
    if command -v ps >/dev/null 2>&1; then
      # Helpful context for non-technical users.
      echo "Process details:" >&2
      ps -p "$listener_pid" -o pid=,comm=,args= 2>/dev/null || true
    fi
    echo "" >&2

    # If it looks like a previous codex-pocket/local-orbit Bun process, we can kill it safely.
    if ps -p "$listener_pid" -o args= 2>/dev/null | grep -q "$APP_DIR/app/services/local-orbit/src/index.ts"; then
      if confirm "It looks like an old Codex Pocket server. Kill it and continue?"; then
        kill "$listener_pid" >/dev/null 2>&1 || true
        sleep 0.3
      else
        if confirm "Use a different port automatically instead?"; then
          new_port="$(find_free_port 8791 8899 || true)"
          [[ -n "${new_port:-}" ]] || abort "No free port found in 8791-8899."
          LOCAL_PORT="$new_port"
          echo "Using port ${LOCAL_PORT}." >&2
        else
          echo "Aborting install. Re-run after stopping the process, or set ZANE_LOCAL_PORT to use a different port." >&2
          exit 1
        fi
      fi
    else
      echo "This does not look like Codex Pocket (or it could not be verified)." >&2
      echo "Options:" >&2
      echo "  1) Stop that process and re-run this installer." >&2
      echo "  2) Re-run with a different port, e.g.: ZANE_LOCAL_PORT=8791" >&2
      if confirm "Kill PID $listener_pid anyway and continue?"; then
        kill "$listener_pid" >/dev/null 2>&1 || true
        sleep 0.3
      else
        if confirm "Use a different port automatically instead?"; then
          new_port="$(find_free_port 8791 8899 || true)"
          [[ -n "${new_port:-}" ]] || abort "No free port found in 8791-8899."
          LOCAL_PORT="$new_port"
          echo "Using port ${LOCAL_PORT}." >&2
        else
          echo "Aborting install. Re-run after stopping the process, or set ZANE_LOCAL_PORT to use a different port." >&2
          exit 1
        fi
      fi
    fi

    # Re-check after attempting to kill.
    if lsof -nP -t -iTCP:${LOCAL_PORT} -sTCP:LISTEN 2>/dev/null | head -n 1 | rg -q .; then
      echo "Error: port ${LOCAL_PORT} is still in use. Re-run after freeing it, or set ZANE_LOCAL_PORT to use a different port." >&2
      exit 1
    fi
  fi
fi

launchctl unload "$PLIST" >/dev/null 2>&1 || true
load_out="$(launchctl load "$PLIST" 2>&1)" || true
if echo "$load_out" | grep -qi "Load failed: 5"; then
  echo "Warning: launchd could not load the agent (launchctl error 5)." >&2
  echo "Falling back to starting the service in the background (no auto-start on login)." >&2
  start_background
elif [[ -z "${load_out:-}" ]]; then
  STARTED_VIA="launchd"
elif [[ -n "$load_out" ]]; then
  # Non-fatal warnings (launchctl is chatty on newer macOS).
  echo "$load_out" >&2
  STARTED_VIA="launchd"
fi

step "Waiting for service to start"
if wait_for_local_orbit; then
  echo "Service: running"
else
  echo "Warning: service did not become healthy at http://127.0.0.1:${LOCAL_PORT}/health" >&2
  echo "Check logs: $APP_DIR/server.log" >&2
fi

step "Validating admin API"
if wait_for_admin_auth; then
  echo "Admin: authorized"
else
  echo "Warning: admin API did not authorize at http://127.0.0.1:${LOCAL_PORT}/admin/status" >&2
  echo "You may have a stale process or token mismatch. Check logs: $APP_DIR/server.log" >&2
fi

step "Expose via Tailscale (recommended)"
if confirm "Configure 'tailscale serve' for iPhone access now?"; then
  serve_out="$("$TAILSCALE_BIN" serve --bg http://127.0.0.1:${LOCAL_PORT} 2>&1)" || true
  if echo "$serve_out" | grep -qi "Serve is not enabled on your tailnet"; then
    echo "$serve_out" >&2
    echo "" >&2
    pause "After enabling Serve (see link above), press Enter to retry..."
    serve_out="$("$TAILSCALE_BIN" serve --bg http://127.0.0.1:${LOCAL_PORT} 2>&1)" || true
  fi

  if echo "$serve_out" | grep -qi "Available within your tailnet"; then
    echo "Tailscale serve configured."
  else
    echo "$serve_out" >&2
    echo "Warning: tailscale serve may not be configured. You can retry later with:" >&2
    echo "  $TAILSCALE_BIN serve --bg http://127.0.0.1:${LOCAL_PORT}" >&2
  fi
else
  echo "Skipping tailscale serve configuration."
fi

cat <<EON

To expose on your tailnet:

  $TAILSCALE_BIN serve --bg http://127.0.0.1:${LOCAL_PORT}

Then open on iPhone:
  https://$("$TAILSCALE_BIN" status --json 2>/dev/null | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  name=d.get("Self",{}).get("DNSName","<your-magicdns-host>")
  # Tailscale typically includes a trailing dot.
  print(name[:-1] if isinstance(name,str) and name.endswith(".") else name)
except Exception:
  print("<your-magicdns-host>")')

Access Token (save this):
  ${ZANE_LOCAL_TOKEN}

EON

step "Install CLI"
mkdir -p "$APP_DIR/bin"
cp "$APP_DIR/app/bin/codex-pocket" "$APP_DIR/bin/codex-pocket"
chmod +x "$APP_DIR/bin/codex-pocket"

echo ""
step "Summary"
echo "Install dir:      $APP_DIR/app"
echo "Config:           $CONFIG_JSON"
echo "Local URL:        http://127.0.0.1:${LOCAL_PORT}"
echo "Admin URL:        http://127.0.0.1:${LOCAL_PORT}/admin"
echo "Access Token:     $ZANE_LOCAL_TOKEN"
echo "Service started via: $STARTED_VIA"
echo "Launchd agent:    $PLIST"
echo "Logs:             $APP_DIR/server.log"
echo "Anchor logs:      $ANCHOR_LOG"

if [[ -n "${MAGICDNS_HOST:-}" ]]; then
  echo "Tailnet URL:      https://$MAGICDNS_HOST/"
  echo "Tailnet Admin:    https://$MAGICDNS_HOST/admin"
  if curl -fsS "https://$MAGICDNS_HOST/health" >/dev/null 2>&1; then
    echo "Tailnet check:    ok"
  else
    echo "Tailnet check:    failed (you can still use Local URL)."
  fi
fi

echo ""
echo "Add to PATH (zsh):"
echo "  echo 'export PATH=\"$APP_DIR/bin:$PATH\"' >> ~/.zshrc"
echo ""
echo "Then you can run:"
echo "  codex-pocket doctor"
echo "  codex-pocket status"

echo "Installed."

echo ""
if confirm "Open the Admin page now (to pair your iPhone)?"; then
  if curl -fsS "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:${LOCAL_PORT}/admin" >/dev/null 2>&1 || true
  else
    echo "Not opening Admin because the service is not reachable at http://127.0.0.1:${LOCAL_PORT}/health" >&2
    echo "Check logs: $APP_DIR/server.log" >&2
  fi
fi
