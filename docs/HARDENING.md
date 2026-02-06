# Security Hardening

This doc contains concrete steps to reduce risk beyond the default configuration.

## 1) Keep It On The Tailnet

Recommended exposure pattern:
- local-orbit binds to `127.0.0.1`
- you expose it via:

```bash
tailscale serve --bg http://127.0.0.1:8790
```

Do not bind local-orbit to `0.0.0.0` unless you are intentionally serving it on your LAN.

## 2) Use Tailscale ACLs

If you have Tailscale ACLs enabled (Tailnet admin console), restrict access to the Mac’s serve port.

Example ACL idea (conceptual):
- allow only your iPhone device/user to reach the Mac on HTTPS
- deny other tailnet devices

Because ACL syntax varies with tailnet setup, the easiest approach is:
- put the Mac in a restricted tag/group
- allow inbound only from your user or a specific device group

## 3) Rotate The Bearer Token

If any device is lost/compromised, rotate the token.

Fast rotate (re-run installer) or manually:
1. Stop the service.
2. Edit `~/Library/LaunchAgents/com.codex.remote.plist` and change `ZANE_LOCAL_TOKEN`.
3. Restart the service.
4. Re-pair iPhone via `/admin`.

## 4) Reduce Data Retention

Persisted events can include diffs and tool outputs. Reduce retention:

- set `ZANE_LOCAL_RETENTION_DAYS=1` (or `0` to disable pruning, not recommended)

If you want to disable persistence entirely, we can add a flag to stop writing events.

## 5) Limit What Gets Logged

- The Anchor log (`~/.zane-local/anchor.log`) can include sensitive content.
- Prefer reviewing diffs/approvals rather than dumping secrets into prompts.

## 6) Separate Users (Optional)

If multiple people use the same Mac account, create a dedicated macOS user for Codex Remote.
