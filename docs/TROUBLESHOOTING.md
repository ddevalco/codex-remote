# Troubleshooting

## iPhone can't open the site
- Ensure you ran `tailscale up` on the Mac.
- Ensure you configured serving:

```bash
tailscale serve status
```

- Ensure the service is running:

```bash
curl -i http://127.0.0.1:8790/health
```

## WebSocket won't connect
- Confirm the Orbit URL is `wss://<your-host>/ws`.
- In local mode it should auto-populate; if not, open Settings and verify.

## Pairing code fails
- Pairing codes are one-time and expire (default 5 minutes).
- Generate a fresh code from `/admin`.

## Anchor not connected
- Wait a few seconds after service start; anchor auto-starts.
- Check `/admin` logs.
- Confirm `codex` is installed and authenticated.

## Threads show up but transcript is blank
Depending on your `codex app-server` version, thread history may not be replayed to third-party clients on open.
In that case:
- You may still see thread metadata in the list.
- Only new activity observed while Codex Pocket is connected will appear in the transcript/review.

To verify whether Codex Pocket has stored any events for a thread:
1. Open `http://127.0.0.1:8790/thread/<threadId>/review`
2. If it says "No activity found", the service has not observed any events for that thread yet.

## Codex desktop app doesn't show messages sent from Codex Pocket
Codex Pocket communicates with `codex app-server` directly and renders its own UI.
If a message appears in Codex Pocket but not in the Codex desktop app UI:
- refresh/reopen the thread in the desktop app
- if needed, restart the desktop app
