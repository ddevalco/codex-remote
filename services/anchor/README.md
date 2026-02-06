# Anchor

Local bridge that runs `codex app-server` and relays JSON-RPC over WebSocket.

## Run

```bash
cd services/anchor
bun install
bun run dev
```

Requirements:

- Codex CLI installed and authenticated (`codex login`)
- `codex app-server` available on PATH

## Configuration

Env is loaded from the repo root `.env` via the run scripts.

| Variable | Default | Description |
|----------|---------|-------------|
| `ANCHOR_PORT` | `8788` | Local WebSocket server port |
| `ANCHOR_ORBIT_URL` | _(empty)_ | Orbit relay URL (e.g. `wss://orbit.<domain>.workers.dev/ws/anchor`) |
| `AUTH_URL` | _(empty)_ | Auth service URL for device code login |
| `ZANE_ANCHOR_JWT_SECRET` | _(empty)_ | Shared secret for Orbit service-to-service auth |
| `ANCHOR_JWT_TTL_SEC` | `300` | JWT token lifetime in seconds |
| `ANCHOR_APP_CWD` | `process.cwd()` | Working directory sent to app-server during init |
| `ZANE_CREDENTIALS_FILE` | `~/.zane/credentials.json` | Path to stored login credentials |

## WebSocket endpoint

- `ws://localhost:8788/ws/anchor`
