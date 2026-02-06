#!/usr/bin/env bash
set -euo pipefail

# ── Zane Installer ──────────────────────────────
# Usage: curl -fsSL https://raw.githubusercontent.com/z-siddiqi/zane/main/install.sh | bash

ZANE_HOME="${ZANE_HOME:-$HOME/.zane}"
ZANE_REPO="${ZANE_REPO:-https://github.com/z-siddiqi/zane.git}"
ZANE_BRANCH="${ZANE_BRANCH:-}"

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

# ── Cleanup on failure ──────────────────────────
cleanup() {
  if [[ $? -ne 0 ]]; then
    echo ""
    warn "Installation failed. Partial files may exist at $ZANE_HOME"
  fi
}
trap cleanup EXIT

# ── Banner ──────────────────────────────────────
echo ""
printf "${BOLD}Zane Installer${RESET}\n"
echo ""

# ── Check OS ────────────────────────────────────
if [[ "$(uname -s)" != "Darwin" ]]; then
  abort "Zane currently only supports macOS. Linux and Windows support is coming soon."
fi
pass "macOS detected"

# ── Check git ───────────────────────────────────
step "Checking prerequisites..."

if command -v git &>/dev/null; then
  pass "git installed"
else
  warn "git not found. Installing Xcode Command Line Tools..."
  xcode-select --install 2>/dev/null || true
  echo "   Please complete the Xcode CLT installation and re-run this script."
  exit 1
fi

# ── Check/install Bun ───────────────────────────
if command -v bun &>/dev/null; then
  pass "bun $(bun --version)"
else
  warn "bun not found"
  if confirm "  Install bun?"; then
    curl -fsSL https://bun.sh/install | bash
    # Source bun into current shell
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if command -v bun &>/dev/null; then
      pass "bun installed ($(bun --version))"
    else
      abort "Failed to install bun. Install manually: https://bun.sh"
    fi
  else
    abort "bun is required. Install it from https://bun.sh"
  fi
fi

# ── Check/install codex CLI ─────────────────────
if command -v codex &>/dev/null; then
  pass "codex CLI installed"
else
  warn "codex CLI not found"
  echo ""
  echo "  The codex CLI is required to run Zane."
  echo ""
  if command -v brew &>/dev/null; then
    if confirm "  Install codex via Homebrew?"; then
      brew install codex
      if command -v codex &>/dev/null; then
        pass "codex installed"
      else
        abort "Failed to install codex."
      fi
    else
      abort "codex is required. Install it manually: https://github.com/openai/codex"
    fi
  else
    echo "  Install codex manually and re-run this script."
    echo "  See: https://github.com/openai/codex"
    exit 1
  fi
fi

# ── Check codex authentication ──────────────────
echo ""
echo "  Checking codex authentication..."
if codex login status &>/dev/null 2>&1; then
  pass "codex authenticated"
else
  warn "codex is not authenticated"
  echo ""
  echo "  Please run 'codex login' to authenticate, then re-run this script."
  echo ""
  if confirm "  Run 'codex login' now?"; then
    codex login
    if codex login status &>/dev/null 2>&1; then
      pass "codex authenticated"
    else
      warn "codex authentication may have failed. You can try again later."
    fi
  fi
fi

# ── Clone/update repo ──────────────────────────
step "Installing Zane to $ZANE_HOME..."

if [[ -d "$ZANE_HOME/.git" ]]; then
  echo "  Existing installation found. Updating..."
  git -C "$ZANE_HOME" pull --rebase --quiet
  pass "Updated to latest"
else
  if [[ -d "$ZANE_HOME" ]]; then
    warn "$ZANE_HOME exists but is not a git repo. Backing up..."
    mv "$ZANE_HOME" "$ZANE_HOME.bak.$(date +%s)"
  fi
  if [[ -n "$ZANE_BRANCH" ]]; then
    git clone --depth 1 --branch "$ZANE_BRANCH" "$ZANE_REPO" "$ZANE_HOME"
  else
    git clone --depth 1 "$ZANE_REPO" "$ZANE_HOME"
  fi
  pass "Cloned repository"
fi

# ── Install anchor dependencies ─────────────────
echo "  Installing anchor dependencies..."
(cd "$ZANE_HOME/services/anchor" && bun install --silent)
pass "Anchor dependencies installed"

# ── Mode selection ──────────────────────────────
step "Setup mode"
echo ""
echo "  How do you want to run Zane?"
echo ""
printf "  ${DIM}1) Hosted (coming soon)${RESET}\n"
printf "  ${DIM}   Run the anchor locally, connect to cloud services.${RESET}\n"
echo ""
printf "  ${BOLD}2)${RESET} Self-host\n"
echo "     Deploy everything to your own Cloudflare account."
echo ""
printf "  Choose [2]: "
read -r mode_choice

if [[ "${mode_choice:-2}" == "1" ]]; then
  warn "Hosted mode is not available yet. Falling back to self-host."
  mode_choice="2"
fi

# ── Self-host setup ────────────────────────────
if [[ "${mode_choice:-2}" == "2" ]]; then
  step "Self-host setup"

  local_wizard="$ZANE_HOME/bin/self-host.sh"
  if [[ -f "$local_wizard" ]]; then
    # shellcheck source=/dev/null
    source "$local_wizard"
  else
    echo ""
    echo "  The self-host wizard will guide you through deploying"
    echo "  Auth, Orbit, and the Web frontend to your Cloudflare account."
    echo ""

    cat > "$ZANE_HOME/.env" <<ENVEOF
# Zane Anchor Configuration (self-host)
# Run 'zane self-host' to complete setup.
ANCHOR_PORT=8788
ANCHOR_ORBIT_URL=
AUTH_URL=
ANCHOR_JWT_TTL_SEC=300
ANCHOR_APP_CWD=
ENVEOF

    warn "Self-host wizard not yet available."
    echo "  A basic .env has been created. Run 'zane self-host' after installation"
    echo "  to complete the Cloudflare deployment."
  fi
fi

# ── Install CLI ─────────────────────────────────
step "Installing CLI..."

mkdir -p "$ZANE_HOME/bin"

cli_src="$ZANE_HOME/bin/zane"
if [[ ! -f "$cli_src" ]]; then
  abort "CLI script not found at $cli_src"
fi

chmod +x "$cli_src"
pass "CLI installed at $ZANE_HOME/bin/zane"

# Add to PATH
path_line='export PATH="$HOME/.zane/bin:$PATH"'
added_to=""

for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [[ -f "$rc" ]]; then
    if ! grep -q '.zane/bin' "$rc"; then
      echo "" >> "$rc"
      echo "# Zane" >> "$rc"
      echo "$path_line" >> "$rc"
      added_to="${added_to} $(basename "$rc")"
    fi
  fi
done

# If neither rc file existed, create .zshrc (macOS default shell)
if [[ -z "$added_to" ]]; then
  echo "" >> "$HOME/.zshrc"
  echo "# Zane" >> "$HOME/.zshrc"
  echo "$path_line" >> "$HOME/.zshrc"
  added_to=" .zshrc"
fi

# Make it available in the current shell
export PATH="$ZANE_HOME/bin:$PATH"

pass "Added to PATH in$added_to"

# ── Done ────────────────────────────────────────
echo ""
printf "${GREEN}${BOLD}Zane installed successfully!${RESET}\n"
echo ""
echo "  Get started:"
printf "    ${BOLD}zane start${RESET}    Start the anchor service\n"
printf "    ${BOLD}zane doctor${RESET}   Check your setup\n"
printf "    ${BOLD}zane config${RESET}   Edit configuration\n"
printf "    ${BOLD}zane help${RESET}     See all commands\n"
echo ""
echo "  You may need to restart your terminal or run:"
echo "    source ~/.zshrc"
echo ""
