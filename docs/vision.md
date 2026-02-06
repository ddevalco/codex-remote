# Vision

## Goal
Enable a single developer to start and supervise Codex CLI sessions running on their Mac from a remote handheld device via a web client. Cloudflare provides the control plane and relay; execution stays local via the Anchor service (local bridge).

## Primary User
- A solo developer who runs Codex CLI locally and wants to monitor or approve actions while away from their desk.

## Core Use Cases
1. Start a Codex task remotely (manual or webhook-triggered).
2. Watch real-time output (logs, diffs, errors) from a phone.
3. Approve or deny actions when Codex requests permission.
4. Take over the session for direct input (send keystrokes).

## Non-Goals
- Cloud-hosted execution of the agent (no remote container execution).
- End-to-end encryption (considered later).
- Full mobile native app (web only for now).
- Windows/Linux support (macOS only).

## Principles
- Local-first: Anchor (local bridge) is the only component that executes commands.
- Outbound-only: no inbound ports to the Mac.
- Minimal authentication: WebAuthn passkeys with JWTs for MVP.
- Low coupling: Anchor, Orbit, and the client can evolve independently.
- Structured protocol: use `codex app-server` JSON-RPC instead of PTY parsing.

## Product Shape
- **Anchor** (local bridge): spawns `codex app-server` and relays JSON-RPC; surfaces approval prompts; accepts input.
- **Orbit** (control plane): Cloudflare Worker + Durable Object; relays WebSocket traffic; stores minimal session metadata.
- **Client**: static web UI (Cloudflare Pages); shows live output; approve/deny; send input.

## Design Decisions
- macOS only.
- Web client is static (no server-side runtime).
- Multiple users supported (each with multiple devices).
- WebAuthn passkey auth with JWT tokens.
- Anchor uses Bun for local tooling and runtime.
- Pass-through JSON-RPC from `codex app-server` to the client.
- Single `codex app-server` process with multiple threads.

## Success Criteria
- Remote user can see live Codex output within 1-2 seconds.
- Approvals can be granted/denied remotely without re-running tasks.
- Codex sessions can be started via webhook or manually from the web UI.
- Local execution never requires inbound network access.

## Open-Core Model

Zane is open source under the [MIT license](../LICENSE). A hosted Orbit relay is planned so you can get started without deploying any infrastructure. Join the [waitlist](https://getzane.pages.dev) to get early access. If you want full control today, you can [self-host](../README.md#self-hosting) everything on your own Cloudflare account.
