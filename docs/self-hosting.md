# Self-Hosting

Zane can be fully self-hosted on your own Cloudflare account. The `zane self-host` wizard automates the entire process, but this page explains what it does and what you need beforehand.

## Prerequisites

- **macOS** with [Bun](https://bun.sh) and [Codex CLI](https://github.com/openai/codex) installed
- **A Cloudflare account** (the [free tier](https://www.cloudflare.com/plans/) is sufficient)
- **Zane installed** via the [install script](installation.md)

The wizard will install [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (the Cloudflare CLI) and prompt you to log in if needed.

## What gets deployed

The wizard deploys three services to your Cloudflare account:

| Service | Platform | Purpose |
|---------|----------|---------|
| **Auth** | Cloudflare Worker | Passkey registration/login, JWT issuance |
| **Orbit** | Cloudflare Worker + Durable Object | WebSocket relay between devices and Anchor |
| **Web** | Cloudflare Pages | Static Svelte frontend |

It also creates a shared **D1 database** (SQLite) for auth sessions, passkey credentials, and event storage.

All three services share two generated JWT secrets (`ZANE_WEB_JWT_SECRET` and `ZANE_ANCHOR_JWT_SECRET`) that are set as Cloudflare secrets automatically.

## Running the wizard

```bash
zane self-host
```

The wizard walks through 10 steps:

1. Checks for Wrangler and Cloudflare login
2. Creates a D1 database
3. Updates `wrangler.toml` files with the database ID
4. Generates JWT secrets
5. Runs database migrations
6. Deploys the Auth worker and sets secrets
7. Deploys the Orbit worker and sets secrets
8. Builds and deploys the web frontend to Pages
9. Sets the `PASSKEY_ORIGIN` secret (your Pages URL)
10. Writes the Anchor `.env` with your Orbit and Auth URLs

At the end, it prints your deployment URLs and next steps.

## After deployment

1. Open your Pages URL (printed by the wizard) and create your account
2. Run `zane start` to connect your local Anchor to your self-hosted Orbit

## Updating a self-hosted deployment

After running `zane update` to pull the latest code, redeploy the services:

```bash
cd ~/.zane/services/auth && bunx wrangler deploy
cd ~/.zane/services/orbit && bunx wrangler deploy
cd ~/.zane && bun run build && bunx wrangler pages deploy dist --project-name zane
```

## Architecture

See [architecture.md](architecture.md) for details on how the components communicate.
