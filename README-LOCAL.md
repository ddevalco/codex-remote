# Zane Local (Tailscale-only)

This is a fork of Zane that removes the Cloudflare dependency.

## What Works (MVP)
- A local relay service ("local-orbit") running on your Mac.
- Anchor connects to local-orbit over `ws://127.0.0.1`.
- The web UI connects to local-orbit over your Tailscale network.

## Security Model (Local Mode)
- No passkeys.
- One shared bearer token (`ZANE_LOCAL_TOKEN`) required for both:
  - browser -> local-orbit (client WebSocket)
  - anchor -> local-orbit (anchor WebSocket)

You should restrict access at the network layer using Tailscale ACLs and device auth.

## Quick Start

### 1) Pick a token
Generate a long random token, e.g.:

```bash
openssl rand -hex 32
```

Export it in the terminals where you run local-orbit and the web UI:

```bash
export ZANE_LOCAL_TOKEN="<paste token>"
```

Or generate one via the helper CLI:

```bash
/Users/danedevalcourt/iPhoneApp/zane-local/bin/zane-local token
```

### 2) Run local-orbit on the Mac

```bash
cd /Users/danedevalcourt/iPhoneApp/zane-local
ZANE_LOCAL_TOKEN="$ZANE_LOCAL_TOKEN" bun run services/local-orbit/src/index.ts
```

It listens on `127.0.0.1:8790` by default.

### 3) Run Anchor on the Mac
In a second terminal:

```bash
cd /Users/danedevalcourt/iPhoneApp/zane-local/services/anchor
export ANCHOR_HOST=127.0.0.1
export ANCHOR_PORT=8788
export ANCHOR_ORBIT_URL="ws://127.0.0.1:8790/ws/anchor"
export ZANE_ANCHOR_JWT_SECRET="$ZANE_LOCAL_TOKEN"

bun run src/index.ts
```

### 4) Run the web UI (dev) on the Mac

```bash
cd /Users/danedevalcourt/iPhoneApp/zane-local
export VITE_ZANE_LOCAL=1
bun run dev -- --host 127.0.0.1 --port 5173
```

### 5) Expose the web UI and WS over Tailscale
Use `tailscale serve` to expose both the UI and the WebSocket on your tailnet.

Example (adjust if you already use `tailscale serve` for other things):

```bash
# Serve the UI on https://danes-macbook-air.tail750f21.ts.net/
tailscale serve https / http://127.0.0.1:5173

# Serve the WebSocket endpoint on https://danes-macbook-air.tail750f21.ts.net/ws
# (this is the browser-facing client socket)
tailscale serve https /ws http://127.0.0.1:8790/ws/client
```

Then on your iPhone open:
- `https://danes-macbook-air.tail750f21.ts.net/`

In the app Settings set:
- Server URL: `wss://danes-macbook-air.tail750f21.ts.net/ws`
- Token: paste `ZANE_LOCAL_TOKEN`

## Admin UI (WIP)

Local mode now serves the UI, admin panel, WebSockets, and API from a single process (`local-orbit`).

```bash
cd /Users/danedevalcourt/iPhoneApp/zane-local
VITE_ZANE_LOCAL=1 bun run build
ZANE_LOCAL_TOKEN="$ZANE_LOCAL_TOKEN" bun run services/local-orbit/src/index.ts
```

Then you can visit:
- `/` for the app UI
- `/admin` for admin UI (requires Authorization token for API calls; the UI uses your stored token)

## Hardening Recommendations
- Keep local-orbit bound to `127.0.0.1` and only expose it via `tailscale serve`.
- Use Tailscale ACLs to restrict which devices/users can reach the served ports.
- Treat `ZANE_LOCAL_TOKEN` like a password; rotate if any device is compromised.
