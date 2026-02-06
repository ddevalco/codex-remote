#!/usr/bin/env bash
# ── Zane Self-Host Wizard ───────────────────────
# Deploys Auth, Orbit, and Web to your Cloudflare account.
# Sourced by `zane self-host` or the install script.

set -euo pipefail

ZANE_HOME="${ZANE_HOME:-$HOME/.zane}"
ENV_FILE="$ZANE_HOME/.env"

# ── Colors ──────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

pass()  { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$1"; }
warn()  { printf "  ${YELLOW}⚠${RESET} %s\n" "$1"; }
step()  { printf "\n${BOLD}%s${RESET}\n" "$1"; }

abort() {
  printf "\n${RED}Error: %s${RESET}\n" "$1"
  exit 1
}

confirm() {
  local prompt="$1"
  printf "%s [Y/n] " "$prompt"
  read -r answer
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

# ── Prerequisites ───────────────────────────────
step "1. Checking prerequisites"

# Check wrangler
if command -v wrangler &>/dev/null; then
  pass "wrangler installed"
else
  warn "wrangler not found"
  if confirm "  Install wrangler globally via bun?"; then
    bun add -g wrangler
    if command -v wrangler &>/dev/null; then
      pass "wrangler installed"
    else
      abort "Failed to install wrangler."
    fi
  else
    abort "wrangler is required. Run: bun add -g wrangler"
  fi
fi

# Check Cloudflare login
if wrangler whoami &>/dev/null 2>&1; then
  pass "Cloudflare authenticated"
else
  warn "Not logged in to Cloudflare"
  if confirm "  Run 'wrangler login' now?"; then
    wrangler login
    if wrangler whoami &>/dev/null 2>&1; then
      pass "Cloudflare authenticated"
    else
      abort "Cloudflare authentication failed."
    fi
  else
    abort "Cloudflare login required. Run: wrangler login"
  fi
fi

# ── Create D1 Database ──────────────────────────
step "2. Creating D1 database"

echo "  Creating database 'zane'..."
db_output=$(wrangler d1 create zane 2>&1) || true

# Extract database_id from output
database_id=$(echo "$db_output" | grep -o 'database_id = "[^"]*"' | head -1 | cut -d'"' -f2 || true)

if [[ -z "$database_id" ]]; then
  # Database might already exist
  warn "Could not create database (may already exist)."
  echo ""
  printf "  Enter your D1 database ID: "
  read -r database_id
  if [[ -z "$database_id" ]]; then
    abort "Database ID is required. Run 'wrangler d1 list' to find it."
  fi
fi

pass "Database ID: $database_id"

# ── Update wrangler.toml files ──────────────────
step "3. Updating wrangler.toml configurations"

old_db_id="ca5a5a6b-6822-4246-8fc2-136ed5b1c6a0"

for toml_path in \
  "$ZANE_HOME/wrangler.toml" \
  "$ZANE_HOME/services/auth/wrangler.toml" \
  "$ZANE_HOME/services/orbit/wrangler.toml"; do

  if [[ -f "$toml_path" ]]; then
    sed -i '' "s/$old_db_id/$database_id/g" "$toml_path"
    pass "Updated $(basename "$(dirname "$toml_path")")/wrangler.toml"
  fi
done

# ── Generate secrets ────────────────────────────
step "4. Generating secrets"

web_jwt_secret=$(openssl rand -base64 32)
anchor_jwt_secret=$(openssl rand -base64 32)

pass "ZANE_WEB_JWT_SECRET generated"
pass "ZANE_ANCHOR_JWT_SECRET generated"

# ── Run database migrations ─────────────────────
step "5. Running database migrations"

(cd "$ZANE_HOME" && bunx wrangler d1 migrations apply zane --remote)
pass "Migrations applied"

# ── Deploy auth worker ──────────────────────────
step "6. Deploying auth worker"

(cd "$ZANE_HOME/services/auth" && bun install --silent)

echo "$web_jwt_secret" | wrangler secret put ZANE_WEB_JWT_SECRET --name zane 2>/dev/null || true
echo "$anchor_jwt_secret" | wrangler secret put ZANE_ANCHOR_JWT_SECRET --name zane 2>/dev/null || true

auth_output=$(cd "$ZANE_HOME/services/auth" && bunx wrangler deploy 2>&1)
echo "$auth_output"

# Try to extract the worker URL
auth_url=$(echo "$auth_output" | grep -oE 'https://[^ ]+\.workers\.dev' | head -1 || true)
if [[ -z "$auth_url" ]]; then
  echo ""
  printf "  Enter your auth worker URL (e.g. https://zane.your-subdomain.workers.dev): "
  read -r auth_url
fi

pass "Auth worker deployed: $auth_url"

# ── Deploy orbit worker ─────────────────────────
step "7. Deploying orbit worker"

(cd "$ZANE_HOME/services/orbit" && bun install --silent)

echo "$web_jwt_secret" | wrangler secret put ZANE_WEB_JWT_SECRET --name orbit 2>/dev/null || true
echo "$anchor_jwt_secret" | wrangler secret put ZANE_ANCHOR_JWT_SECRET --name orbit 2>/dev/null || true

orbit_output=$(cd "$ZANE_HOME/services/orbit" && bunx wrangler deploy 2>&1)
echo "$orbit_output"

orbit_url=$(echo "$orbit_output" | grep -oE 'https://[^ ]+\.workers\.dev' | head -1 || true)
if [[ -z "$orbit_url" ]]; then
  echo ""
  printf "  Enter your orbit worker URL (e.g. https://orbit.your-subdomain.workers.dev): "
  read -r orbit_url
fi

pass "Orbit worker deployed: $orbit_url"

# Derive WebSocket URL from HTTPS URL
orbit_ws_url=$(echo "$orbit_url" | sed 's|^https://|wss://|')/ws/anchor

# ── Build and deploy web ────────────────────────
step "8. Building and deploying web frontend"

(cd "$ZANE_HOME" && bun install --silent)

echo "  Building with AUTH_URL=$auth_url ..."
(cd "$ZANE_HOME" && AUTH_URL="$auth_url" bun run build)

pages_output=$(cd "$ZANE_HOME" && bunx wrangler pages deploy dist --project-name zane 2>&1)
echo "$pages_output"

pages_url=$(echo "$pages_output" | grep -oE 'https://[^ ]+\.pages\.dev' | head -1 || true)
if [[ -z "$pages_url" ]]; then
  echo ""
  printf "  Enter your Pages URL (e.g. https://zane-xxx.pages.dev): "
  read -r pages_url
fi

pass "Web deployed: $pages_url"

# ── Set PASSKEY_ORIGIN ──────────────────────────
step "9. Setting PASSKEY_ORIGIN"

echo "$pages_url" | wrangler secret put PASSKEY_ORIGIN --name zane 2>/dev/null || true
pass "PASSKEY_ORIGIN set to $pages_url"

# ── Generate .env for anchor ────────────────────
step "10. Configuring anchor"

cat > "$ENV_FILE" <<ENVEOF
# Zane Anchor Configuration (self-host)
ANCHOR_PORT=8788
ANCHOR_ORBIT_URL=${orbit_ws_url}
AUTH_URL=${auth_url}
ANCHOR_JWT_TTL_SEC=300
ANCHOR_APP_CWD=
ENVEOF

pass "Anchor configuration saved to $ENV_FILE"

# ── Summary ─────────────────────────────────────
echo ""
printf "${GREEN}${BOLD}Self-host deployment complete!${RESET}\n"
echo ""
printf "  ${BOLD}Web:${RESET}    %s\n" "$pages_url"
printf "  ${BOLD}Auth:${RESET}   %s\n" "$auth_url"
printf "  ${BOLD}Orbit:${RESET}  %s\n" "$orbit_url"
echo ""
echo "  Next steps:"
printf "    1. Open ${BOLD}%s${RESET} and create your account\n" "$pages_url"
printf "    2. Run ${BOLD}zane start${RESET} to sign in and launch the anchor\n"
echo ""
