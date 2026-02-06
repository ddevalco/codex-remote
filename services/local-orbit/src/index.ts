import { hostname, homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

// Local Orbit: a minimal replacement for the Cloudflare Orbit/Auth stack.
//
// Goals:
// - No Cloudflare, no DB, no passkeys.
// - Protect access with a single shared bearer token.
// - Relay JSON messages over WebSocket between "client" (browser) and "anchor" (Mac).
// - Support thread subscriptions like the original Orbit.
//
// Intended exposure pattern:
// - Bind to 127.0.0.1
// - Use `tailscale serve` to expose HTTPS/WSS externally on your tailnet.

const PORT = Number(process.env.ZANE_LOCAL_PORT ?? 8790);
const HOST = process.env.ZANE_LOCAL_HOST ?? "127.0.0.1";
const AUTH_TOKEN = (process.env.ZANE_LOCAL_TOKEN ?? "").trim();
const DB_PATH = process.env.ZANE_LOCAL_DB ?? `${homedir()}/.codex-pocket/codex-pocket.db`;
const DB_RETENTION_DAYS = Number(process.env.ZANE_LOCAL_RETENTION_DAYS ?? 14);
const UI_DIST_DIR = process.env.ZANE_LOCAL_UI_DIST_DIR ?? `${process.cwd()}/dist`;

const ANCHOR_CWD = process.env.ZANE_LOCAL_ANCHOR_CWD ?? `${process.cwd()}/services/anchor`;
const ANCHOR_CMD = process.env.ZANE_LOCAL_ANCHOR_CMD?.trim() || "bun";
const ANCHOR_ARGS = (process.env.ZANE_LOCAL_ANCHOR_ARGS?.trim() || "run src/index.ts").split(/\s+/);
const ANCHOR_LOG_PATH = process.env.ZANE_LOCAL_ANCHOR_LOG ?? `${homedir()}/.codex-pocket/anchor.log`;
const ANCHOR_HOST = process.env.ANCHOR_HOST ?? "127.0.0.1";
const ANCHOR_PORT = Number(process.env.ANCHOR_PORT ?? 8788);
const AUTOSTART_ANCHOR = process.env.ZANE_LOCAL_AUTOSTART_ANCHOR !== "0";
const PAIR_TTL_SEC = Number(process.env.ZANE_LOCAL_PAIR_TTL_SEC ?? 300);

if (!AUTH_TOKEN) {
  console.error("[local-orbit] ZANE_LOCAL_TOKEN is required");
  process.exit(1);
}

type Role = "client" | "anchor";

interface AnchorMeta {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
}

function okJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function contentTypeForPath(pathname: string): string | null {
  const p = pathname.toLowerCase();
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".ttf")) return "font/ttf";
  return null;
}

function unauth(): Response {
  return new Response("Unauthorised", { status: 401 });
}

function ensureDbDir(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // ignore
  }
}

ensureDbDir(DB_PATH);
const db = new Database(DB_PATH);
db.exec(
  "CREATE TABLE IF NOT EXISTS events (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "thread_id TEXT NOT NULL," +
    "turn_id TEXT," +
    "direction TEXT NOT NULL," +
    "role TEXT NOT NULL," +
    "method TEXT," +
    "payload TEXT NOT NULL," +
    "created_at INTEGER NOT NULL" +
  ");" +
  "CREATE INDEX IF NOT EXISTS idx_events_thread_created ON events(thread_id, created_at);" +
  "CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);"
);

const insertEvent = db.prepare(
  "INSERT INTO events (thread_id, turn_id, direction, role, method, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

function pruneOldEvents(): void {
  if (!Number.isFinite(DB_RETENTION_DAYS) || DB_RETENTION_DAYS <= 0) return;
  const cutoff = Math.floor(Date.now() / 1000) - DB_RETENTION_DAYS * 24 * 60 * 60;
  try {
    db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff);
  } catch {
    // ignore
  }
}

setInterval(pruneOldEvents, 6 * 60 * 60 * 1000).unref?.();
pruneOldEvents();

let anchorProc: Bun.Subprocess | null = null;

function isAnchorRunning(): boolean {
  return Boolean(anchorProc && anchorProc.exitCode === null);
}

function startAnchor(): { ok: boolean; error?: string } {
  if (isAnchorRunning()) return { ok: true };
  try {
    mkdirSync(dirname(ANCHOR_LOG_PATH), { recursive: true });
    const out = Bun.file(ANCHOR_LOG_PATH);

    // Anchor will connect back to this local-orbit instance as its Orbit endpoint.
    // Token is passed via ZANE_ANCHOR_JWT_SECRET and appended as ?token=... by our patched Anchor buildOrbitUrl().
    anchorProc = Bun.spawn({
      cmd: [ANCHOR_CMD, ...ANCHOR_ARGS],
      cwd: ANCHOR_CWD,
      stdin: "ignore",
      stdout: out,
      stderr: out,
      env: {
        ...process.env,
        ANCHOR_HOST,
        ANCHOR_PORT: String(ANCHOR_PORT),
        ANCHOR_ORBIT_URL: `ws://127.0.0.1:${PORT}/ws/anchor`,
        ZANE_ANCHOR_JWT_SECRET: AUTH_TOKEN,
        AUTH_URL: "",
      },
    });
    anchorProc.exited.then(() => {
      anchorProc = null;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to start anchor" };
  }
}

function stopAnchor(): { ok: boolean; error?: string } {
  if (!isAnchorRunning()) return { ok: true };
  try {
    anchorProc!.kill("SIGTERM");
    anchorProc = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to stop anchor" };
  }
}

function randomPairCode(): string {
  // Crockford-ish base32 without ambiguous chars.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const pairCodes = new Map<string, { token: string; expiresAt: number }>();

function prunePairCodes(): void {
  const now = Date.now();
  for (const [code, rec] of pairCodes) {
    if (now > rec.expiresAt) pairCodes.delete(code);
  }
}

setInterval(prunePairCodes, 60_000).unref?.();

function getBearer(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim();
}

function authorised(req: Request): boolean {
  const provided =
    getBearer(req) ??
    (() => {
      try {
        return new URL(req.url).searchParams.get("token");
      } catch {
        return null;
      }
    })();
  return Boolean(provided && timingSafeEqual(provided, AUTH_TOKEN));
}

// Avoid leaking token timing; Bun/Node doesn't expose a built-in constant-time compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseJsonMessage(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractThreadId(message: Record<string, unknown>): string | null {
  const params = message.params && typeof message.params === "object" ? (message.params as any) : null;
  const result = message.result && typeof message.result === "object" ? (message.result as any) : null;
  const threadFromParams = params?.thread && typeof params.thread === "object" ? params.thread : null;
  const threadFromResult = result?.thread && typeof result.thread === "object" ? result.thread : null;

  const candidates = [
    params?.threadId,
    params?.thread_id,
    result?.threadId,
    result?.thread_id,
    threadFromParams?.id,
    threadFromResult?.id,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
    if (typeof c === "number") return String(c);
  }
  return null;
}

function extractTurnId(message: Record<string, unknown>): string | null {
  const params = message.params && typeof message.params === "object" ? (message.params as any) : null;
  const result = message.result && typeof message.result === "object" ? (message.result as any) : null;
  const candidates = [params?.turnId, params?.turn_id, result?.turnId, result?.turn_id];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
    if (typeof c === "number") return String(c);
  }
  return null;
}

function extractMethod(message: Record<string, unknown>): string | null {
  return typeof (message as any).method === "string" ? ((message as any).method as string) : null;
}

function logEvent(direction: "client" | "server", role: Role, messageText: string): void {
  const msg = parseJsonMessage(messageText);
  if (!msg) return;

  // Don't double-store replays.
  if ((msg as any)._replay) return;

  const threadId = extractThreadId(msg);
  if (!threadId) return;

  const turnId = extractTurnId(msg);
  const method = extractMethod(msg);
  const entry = {
    ts: new Date().toISOString(),
    direction,
    message: msg,
  };

  try {
    insertEvent.run(
      threadId,
      turnId,
      direction,
      role,
      method,
      JSON.stringify(entry),
      Math.floor(Date.now() / 1000)
    );
  } catch {
    // ignore
  }
}

function send(ws: WebSocket, data: unknown): void {
  try {
    ws.send(typeof data === "string" ? data : JSON.stringify(data));
  } catch {
    // ignore
  }
}

// State
const clientSockets = new Map<WebSocket, Set<string>>();
const anchorSockets = new Map<WebSocket, Set<string>>();
const threadToClients = new Map<string, Set<WebSocket>>();
const threadToAnchors = new Map<string, Set<WebSocket>>();
const anchorMeta = new Map<WebSocket, AnchorMeta>();

function listAnchors(): AnchorMeta[] {
  return Array.from(anchorMeta.values());
}

function broadcastToClients(data: unknown): void {
  for (const ws of clientSockets.keys()) send(ws, data);
}

function subscribe(role: Role, ws: WebSocket, threadId: string): void {
  const subs = role === "client" ? clientSockets.get(ws) : anchorSockets.get(ws);
  if (!subs) return;
  if (subs.has(threadId)) return;
  subs.add(threadId);

  const idx = role === "client" ? threadToClients : threadToAnchors;
  const set = idx.get(threadId) ?? new Set<WebSocket>();
  set.add(ws);
  idx.set(threadId, set);

  if (role === "client") {
    // Tell anchors a client is watching; anchor uses this to replay pending approvals.
    for (const a of threadToAnchors.get(threadId) ?? []) {
      send(a, { type: "orbit.client-subscribed", threadId });
    }
  }
}

function unsubscribeAll(role: Role, ws: WebSocket): void {
  const subs = role === "client" ? clientSockets.get(ws) : anchorSockets.get(ws);
  if (!subs) return;

  const idx = role === "client" ? threadToClients : threadToAnchors;
  for (const threadId of subs) {
    const set = idx.get(threadId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) idx.delete(threadId);
    }
  }
  subs.clear();
}

function relay(fromRole: Role, msgText: string): void {
  const msg = parseJsonMessage(msgText);
  if (!msg) return;

  // Local orbit control messages
  if (typeof msg.type === "string" && (msg.type as string).startsWith("orbit.")) {
    if (msg.type === "orbit.subscribe" && typeof msg.threadId === "string") {
      // handled in ws message handler (needs ws + role)
    }
    return;
  }

  const threadId = extractThreadId(msg);
  const targets = fromRole === "client" ? threadToAnchors : threadToClients;

  if (threadId) {
    logEvent(fromRole === "client" ? "client" : "server", fromRole, msgText);
    for (const ws of targets.get(threadId) ?? []) send(ws, msgText);
    return;
  }

  // If no thread id, broadcast to all opposite-role sockets.
  const all = fromRole === "client" ? anchorSockets : clientSockets;
  logEvent(fromRole === "client" ? "client" : "server", fromRole, msgText);
  for (const ws of all.keys()) send(ws, msgText);
}

const server = Bun.serve<{ role: Role }>( {
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return okJson({
        status: "ok",
        host: HOST,
        port: PORT,
        hostname: hostname(),
        clients: clientSockets.size,
        anchors: anchorSockets.size,
        anchor: {
          running: isAnchorRunning(),
          host: ANCHOR_HOST,
          port: ANCHOR_PORT,
          log: ANCHOR_LOG_PATH,
        },
        db: {
          path: DB_PATH,
          retentionDays: DB_RETENTION_DAYS,
        },
      });
    }

    // Admin endpoints (token required)
    if (url.pathname === "/admin/status" && req.method === "GET") {
      if (!authorised(req)) return unauth();
      return okJson({
        server: { host: HOST, port: PORT },
        uiDistDir: UI_DIST_DIR,
        anchor: {
          running: isAnchorRunning(),
          cwd: ANCHOR_CWD,
          host: ANCHOR_HOST,
          port: ANCHOR_PORT,
          log: ANCHOR_LOG_PATH,
        },
        db: { path: DB_PATH, retentionDays: DB_RETENTION_DAYS },
      });
    }

    if (url.pathname === "/admin/pair/new" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      prunePairCodes();
      const code = randomPairCode();
      const expiresAt = Date.now() + PAIR_TTL_SEC * 1000;
      pairCodes.set(code, { token: AUTH_TOKEN, expiresAt });
      const origin = `${url.protocol}//${url.host}`;
      return okJson({
        code,
        expiresAt,
        pairUrl: `${origin}/pair?code=${encodeURIComponent(code)}`,
      });
    }

    if (url.pathname === "/pair/consume" && req.method === "POST") {
      prunePairCodes();
      const body = (await req.json().catch(() => null)) as null | { code?: string };
      const code = body?.code?.trim()?.toUpperCase();
      if (!code) return okJson({ error: "code is required" }, { status: 400 });
      const rec = pairCodes.get(code);
      if (!rec) return okJson({ error: "invalid or expired code" }, { status: 400 });
      if (Date.now() > rec.expiresAt) {
        pairCodes.delete(code);
        return okJson({ error: "invalid or expired code" }, { status: 400 });
      }
      // One-time use.
      pairCodes.delete(code);
      return okJson({ token: rec.token });
    }

    if (url.pathname === "/admin/anchor/start" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      const res = startAnchor();
      return okJson(res, { status: res.ok ? 200 : 500 });
    }

    if (url.pathname === "/admin/anchor/stop" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      const res = stopAnchor();
      return okJson(res, { status: res.ok ? 200 : 500 });
    }

    if (url.pathname === "/admin/logs" && req.method === "GET") {
      if (!authorised(req)) return unauth();
      const svc = url.searchParams.get("service") ?? "anchor";
      if (svc !== "anchor") return new Response("Not found", { status: 404 });
      // Use Bun.file for simplicity; admin UI only needs tail-ish.
      return new Response(Bun.file(ANCHOR_LOG_PATH), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // Compatibility endpoint for the existing web client.
    // Returns NDJSON of stored events (one JSON object per line).
    if (req.method === "GET" && url.pathname.startsWith("/threads/") && url.pathname.endsWith("/events")) {
      if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
      const parts = url.pathname.split("/").filter(Boolean);
      const threadId = parts.length === 3 ? parts[1] : null;
      if (!threadId) return new Response("Not found", { status: 404 });

      try {
        const rows = db
          .prepare("SELECT payload FROM events WHERE thread_id = ? ORDER BY id ASC")
          .all(threadId) as Array<{ payload: string }>;
        const body = rows.length ? rows.map((r) => r.payload).join("\n") + "\n" : "";
        return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
      } catch {
        return new Response("Failed to query events", { status: 500 });
      }
    }

    // Convenience alias for client WS.
    if (url.pathname === "/ws") {
      if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
      if (server.upgrade(req, { data: { role: "client" as Role } })) return new Response(null, { status: 101 });
      return new Response("Upgrade required", { status: 426 });
    }

    if (url.pathname === "/ws/client" || url.pathname === "/ws/anchor") {
      if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
      const role: Role = url.pathname.endsWith("/anchor") ? "anchor" : "client";

      if (server.upgrade(req, { data: { role } })) {
        return new Response(null, { status: 101 });
      }
      return new Response("Upgrade required", { status: 426 });
    }

    // Static UI (built with Vite) + SPA fallback.
    // This lets a single process serve both the UI and the local services.
    if (req.method === "GET") {
      try {
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = `${UI_DIST_DIR}${path}`;
        const file = Bun.file(filePath);
        if (await file.exists()) {
          const ct = contentTypeForPath(path);
          return new Response(file, ct ? { headers: { "content-type": ct } } : undefined);
        }
      } catch {
        // fall through
      }
      // SPA fallback: serve index.html for non-file paths.
      try {
        const index = Bun.file(`${UI_DIST_DIR}/index.html`);
        if (await index.exists()) return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
      } catch {
        // ignore
      }
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const role = ws.data.role;
      if (role === "client") clientSockets.set(ws, new Set());
      else anchorSockets.set(ws, new Set());

      send(ws, {
        type: "orbit.hello",
        ts: new Date().toISOString(),
        role,
      });

      if (role === "anchor") {
        const meta: AnchorMeta = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          hostname: "unknown",
          platform: "unknown",
          connectedAt: new Date().toISOString(),
        };
        anchorMeta.set(ws, meta);
        broadcastToClients({ type: "orbit.anchor-connected", anchor: meta });
      }
    },
    message(ws, message) {
      const role = ws.data.role;
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);

      // Handle control messages
      const obj = parseJsonMessage(text);
      if (obj && typeof obj.type === "string" && (obj.type as string).startsWith("orbit.")) {
        if (obj.type === "orbit.subscribe" && typeof obj.threadId === "string") {
          subscribe(role, ws, obj.threadId);
          return;
        }
        if (obj.type === "orbit.list-anchors") {
          send(ws, { type: "orbit.anchors", anchors: listAnchors() });
          return;
        }
        if (obj.type === "ping") {
          send(ws, { type: "pong" });
          return;
        }
        // ignore others for now
        return;
      }

      // Anchor identity
      if (obj && obj.type === "anchor.hello" && role === "anchor") {
        const meta = anchorMeta.get(ws);
        if (meta) {
          meta.hostname = typeof obj.hostname === "string" ? obj.hostname : meta.hostname;
          meta.platform = typeof obj.platform === "string" ? obj.platform : meta.platform;
          broadcastToClients({ type: "orbit.anchor-connected", anchor: meta });
        }
        return;
      }

      relay(role, text);
    },
    close(ws) {
      const role = ws.data.role;
      unsubscribeAll(role, ws);
      if (role === "client") clientSockets.delete(ws);
      else {
        anchorSockets.delete(ws);
        const meta = anchorMeta.get(ws);
        if (meta) {
          anchorMeta.delete(ws);
          broadcastToClients({ type: "orbit.anchor-disconnected", anchor: meta });
        }
      }
    },
  },
});

console.log(`[local-orbit] listening on http://${HOST}:${server.port}`);
console.log(`[local-orbit] ws client: ws://${HOST}:${server.port}/ws/client`);
console.log(`[local-orbit] ws anchor: ws://${HOST}:${server.port}/ws/anchor`);

if (AUTOSTART_ANCHOR) {
  const res = startAnchor();
  if (!res.ok) {
    console.warn(`[local-orbit] failed to autostart anchor: ${res.error ?? "unknown error"}`);
  }
}
