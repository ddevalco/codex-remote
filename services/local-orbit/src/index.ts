import { hostname, homedir } from "node:os";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { readdir, stat, unlink, mkdir as mkdirAsync } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { Database } from "bun:sqlite";
import QRCode from "qrcode";

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
const CONFIG_JSON_PATH = (process.env.ZANE_LOCAL_CONFIG_JSON ?? "").trim();
let AUTH_TOKEN = (process.env.ZANE_LOCAL_TOKEN ?? "").trim();
const DB_PATH = process.env.ZANE_LOCAL_DB ?? `${homedir()}/.codex-pocket/codex-pocket.db`;
const DB_RETENTION_DAYS = Number(process.env.ZANE_LOCAL_RETENTION_DAYS ?? 14);
const UI_DIST_DIR = process.env.ZANE_LOCAL_UI_DIST_DIR ?? `${process.cwd()}/dist`;
const PUBLIC_ORIGIN = (process.env.ZANE_LOCAL_PUBLIC_ORIGIN ?? "").trim().replace(/\/$/, "");

let UPLOAD_DIR = (process.env.ZANE_LOCAL_UPLOAD_DIR ?? `${homedir()}/.codex-pocket/uploads`).trim();
let UPLOAD_RETENTION_DAYS = Number(process.env.ZANE_LOCAL_UPLOAD_RETENTION_DAYS ?? 0); // 0 = keep forever
const UPLOAD_MAX_BYTES = Number(process.env.ZANE_LOCAL_UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024);
const UPLOAD_URL_TTL_SEC = Number(process.env.ZANE_LOCAL_UPLOAD_URL_TTL_SEC ?? 7 * 24 * 60 * 60);

const ANCHOR_CWD = process.env.ZANE_LOCAL_ANCHOR_CWD ?? `${process.cwd()}/services/anchor`;
const ANCHOR_CMD = process.env.ZANE_LOCAL_ANCHOR_CMD?.trim() || "bun";
const ANCHOR_ARGS = (process.env.ZANE_LOCAL_ANCHOR_ARGS?.trim() || "run src/index.ts").split(/\s+/);
const ANCHOR_LOG_PATH = process.env.ZANE_LOCAL_ANCHOR_LOG ?? `${homedir()}/.codex-pocket/anchor.log`;
const ANCHOR_HOST = process.env.ANCHOR_HOST ?? "127.0.0.1";
const ANCHOR_PORT = Number(process.env.ANCHOR_PORT ?? 8788);
const AUTOSTART_ANCHOR = process.env.ZANE_LOCAL_AUTOSTART_ANCHOR !== "0";
// A stable anchor id prevents duplicate "devices" when the Anchor reconnects.
// Prefer an explicit env override, otherwise fall back to the machine hostname.
const ANCHOR_ID = (process.env.ZANE_LOCAL_ANCHOR_ID ?? hostname()).trim() || "anchor";
const PAIR_TTL_SEC = Number(process.env.ZANE_LOCAL_PAIR_TTL_SEC ?? 300);

const DEFAULT_CONFIG_JSON_PATH = join(homedir(), ".codex-pocket", "config.json");

function loadConfigJson(): Record<string, unknown> | null {
  const path = CONFIG_JSON_PATH || (existsSync(DEFAULT_CONFIG_JSON_PATH) ? DEFAULT_CONFIG_JSON_PATH : "");
  if (!path) return null;
  try {
    // Bun.file().textSync() is not available in all Bun versions; use node:fs for sync reads.
    const text = readFileSync(path, "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tokenFromConfigJson(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  const token = json.token;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

function uploadConfigFromConfigJson(json: Record<string, unknown> | null): void {
  if (!json) return;
  const dir = (json.uploadDir as string | undefined) ?? (json.upload_dir as string | undefined);
  if (typeof dir === "string" && dir.trim()) {
    UPLOAD_DIR = dir.trim();
  }
  const rd = (json.uploadRetentionDays as number | string | undefined) ?? (json.upload_retention_days as any);
  const n = typeof rd === "string" ? Number(rd) : typeof rd === "number" ? rd : NaN;
  if (Number.isFinite(n) && n >= 0) {
    UPLOAD_RETENTION_DAYS = n;
  }
}

const loadedConfig = loadConfigJson();
uploadConfigFromConfigJson(loadedConfig);

// Prefer config.json (so token rotation persists across restarts), fall back to env.
AUTH_TOKEN = tokenFromConfigJson(loadedConfig) ?? AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error("[local-orbit] Access Token is required (set ZANE_LOCAL_TOKEN or provide ZANE_LOCAL_CONFIG_JSON)");
  process.exit(1);
}

type Role = "client" | "anchor";

interface AnchorMeta {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
}

type DiagnoseCheck = {
  id: string;
  ok: boolean;
  summary: string;
  detail?: string;
};

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

function requestOrigin(url: URL, req: Request): string {
  // If we're behind a reverse proxy (like `tailscale serve`) then origin should be the externally
  // visible URL, not necessarily what the local process thinks it is.
  // Prefer explicit config, then forwarded headers, then URL host.
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  const xfProto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const xfHost = (req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim();
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  return `${url.protocol}//${url.host}`;
}

function resolveTailscaleCmd(): string | null {
  try {
    const w = (Bun as any).which;
    if (typeof w === "function") {
      const p = w("tailscale") as string | null | undefined;
      if (p) return p;
    }
  } catch {
    // ignore
  }
  const candidates = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function runCmd(cmd: string, args: string[], timeoutMs = 2500): { ok: boolean; out: string } {
  try {
    const proc = Bun.spawnSync({
      cmd: [cmd, ...args],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    } as any);
    const out = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`.trim();
    return { ok: proc.exitCode === 0, out };
  } catch (e) {
    return { ok: false, out: e instanceof Error ? e.message : "failed to run" };
  }
}

function parseServeMentionsTarget(out: string, target: string): boolean {
  // Very loose check; output formats vary across Tailscale versions.
  return out.includes(target);
}

function fixTailscaleServe(): { ok: boolean; detail: string } {
  if (!PUBLIC_ORIGIN) {
    return { ok: false, detail: "PUBLIC_ORIGIN not set (no tailnet URL configured)" };
  }
  const ts = resolveTailscaleCmd();
  if (!ts) return { ok: false, detail: "tailscale CLI not found" };

  const target = wantServeTarget();
  const st = runCmd(ts, ["serve", "status"], 3000);
  if (st.ok && parseServeMentionsTarget(st.out, target)) {
    return { ok: true, detail: "serve already configured" };
  }

  // Best-effort: configure serve in background. This may fail if Serve isn't enabled on the tailnet.
  const cfg = runCmd(ts, ["serve", "--bg", `http://${target}`], 8000);
  if (!cfg.ok) {
    return { ok: false, detail: cfg.out || "tailscale serve failed" };
  }

  const st2 = runCmd(ts, ["serve", "status"], 3000);
  const ok = st2.ok && parseServeMentionsTarget(st2.out, target);
  return { ok, detail: st2.out || cfg.out };
}

function wantServeTarget(): string {
  // Always serve the loopback target; local-orbit is intended to bind to 127.0.0.1.
  return `127.0.0.1:${PORT}`;
}

async function validateSystem(_req: Request, _url: URL): Promise<{ ok: boolean; checks: DiagnoseCheck[] }>{
  const checks: DiagnoseCheck[] = [];

  // Service health is implied by being able to hit this endpoint.
  checks.push({ id: "server", ok: true, summary: `local-orbit reachable at http://${HOST}:${PORT}` });

  // UI dist
  try {
    const distIndexPath = `${UI_DIST_DIR}/index.html`;
    const exists = await Bun.file(distIndexPath).exists().catch(() => false);
    checks.push({
      id: "ui",
      ok: Boolean(exists),
      summary: exists ? "UI dist found" : "UI dist missing",
      detail: `dist: ${UI_DIST_DIR}`,
    });
  } catch (e) {
    checks.push({ id: "ui", ok: false, summary: "UI dist check failed", detail: e instanceof Error ? e.message : "" });
  }

  // DB
  try {
    db.prepare("SELECT 1").get();
    checks.push({ id: "db", ok: true, summary: "SQLite DB reachable", detail: DB_PATH });
  } catch (e) {
    checks.push({ id: "db", ok: false, summary: "SQLite DB error", detail: e instanceof Error ? e.message : "" });
  }

  // Anchor
  const aRunning = isAnchorRunning();
  const aConnected = anchorSockets.size > 0;
  checks.push({
    id: "anchor",
    ok: aRunning && aConnected,
    summary: aRunning
      ? (aConnected ? "Anchor running + connected" : "Anchor running (not connected yet)")
      : "Anchor not running",
    detail: `running=${aRunning} connected=${aConnected} port=${ANCHOR_PORT}`,
  });

  // Uploads dir existence (do not create here; validate should be non-mutating)
  try {
    const exists = UPLOAD_DIR ? existsSync(UPLOAD_DIR) : false;
    checks.push({
      id: "uploads",
      ok: Boolean(UPLOAD_DIR) && exists,
      summary: exists ? "Uploads dir present" : "Uploads dir missing",
      detail: UPLOAD_DIR || "(not configured)",
    });
  } catch (e) {
    checks.push({ id: "uploads", ok: false, summary: "Uploads check failed", detail: e instanceof Error ? e.message : "" });
  }

  // Tailscale (best-effort)
  const ts = resolveTailscaleCmd();
  if (!ts) {
    checks.push({ id: "tailscale", ok: false, summary: "Tailscale CLI not found", detail: "Install Tailscale or add tailscale to PATH." });
  } else {
    const serve = runCmd(ts, ["serve", "status"], 2500);
    checks.push({
      id: "tailscale",
      ok: true,
      summary: "Tailscale CLI found",
      detail: `${ts}${serve.out ? `\n\nserve status:\n${serve.out.slice(0, 2000)}` : ""}`,
    });

    // If we have a public origin, check that serve status mentions our local port.
    if (PUBLIC_ORIGIN) {
      const want = wantServeTarget();
      const mentions = serve.out.includes(want);
      checks.push({
        id: "tailscale-serve",
        ok: mentions,
        summary: mentions ? "tailscale serve appears configured for this port" : "tailscale serve may not be pointing at this service",
        detail: `publicOrigin=${PUBLIC_ORIGIN} want=${want}`,
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
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

db.exec(
  "CREATE TABLE IF NOT EXISTS upload_tokens (" +
    "token TEXT PRIMARY KEY," +
    "path TEXT NOT NULL," +
    "mime TEXT NOT NULL," +
    "bytes INTEGER NOT NULL," +
    "created_at INTEGER NOT NULL," +
    "expires_at INTEGER NOT NULL" +
  ");" +
  "CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires ON upload_tokens(expires_at);"
);

const insertEvent = db.prepare(
  "INSERT INTO events (thread_id, turn_id, direction, role, method, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const insertUploadToken = db.prepare(
  "INSERT INTO upload_tokens (token, path, mime, bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
);

const getUploadToken = db.prepare(
  "SELECT token, path, mime, bytes, created_at, expires_at FROM upload_tokens WHERE token = ?"
);

const deleteUploadToken = db.prepare("DELETE FROM upload_tokens WHERE token = ?");

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function logAdmin(message: string): void {
  const entry = {
    ts: new Date().toISOString(),
    direction: "admin",
    message: { type: "admin.log", message },
  };
  try {
    insertEvent.run(
      "admin",
      null,
      "server",
      "client",
      "admin.log",
      JSON.stringify(entry),
      nowSec()
    );
  } catch {
    // ignore
  }
}

function pruneOldEvents(): void {
  if (!Number.isFinite(DB_RETENTION_DAYS) || DB_RETENTION_DAYS <= 0) return;
  const cutoff = Math.floor(Date.now() / 1000) - DB_RETENTION_DAYS * 24 * 60 * 60;
  try {
    db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff);
  } catch {
    // ignore
  }
}

async function ensureUploadDir(): Promise<void> {
  try {
    await mkdirAsync(UPLOAD_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function pruneUploads(): Promise<void> {
  // Retention disabled (keep forever)
  if (!Number.isFinite(UPLOAD_RETENTION_DAYS) || UPLOAD_RETENTION_DAYS <= 0) return;
  const cutoffMs = Date.now() - UPLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    await ensureUploadDir();
    const entries = await readdir(UPLOAD_DIR);
    let deleted = 0;
    for (const name of entries) {
      const p = join(UPLOAD_DIR, name);
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.mtimeMs < cutoffMs) {
        try {
          await unlink(p);
          deleted += 1;
        } catch {
          // ignore
        }
      }
    }
    if (deleted > 0) {
      logAdmin(`upload retention: deleted ${deleted} file(s) older than ${UPLOAD_RETENTION_DAYS} day(s)`);
    }
  } catch {
    // ignore
  }
}

function pruneExpiredUploadTokens(): void {
  try {
    db.prepare("DELETE FROM upload_tokens WHERE expires_at < ?").run(nowSec());
  } catch {
    // ignore
  }
}

setInterval(pruneOldEvents, 6 * 60 * 60 * 1000).unref?.();
setInterval(() => void pruneUploads(), 6 * 60 * 60 * 1000).unref?.();
setInterval(pruneExpiredUploadTokens, 10 * 60 * 1000).unref?.();
pruneOldEvents();
void pruneUploads();
pruneExpiredUploadTokens();

let anchorProc: Bun.Subprocess | null = null;

function isAnchorRunning(): boolean {
  return Boolean(anchorProc && anchorProc.exitCode === null);
}

function startAnchor(): { ok: boolean; error?: string } {
  if (isAnchorRunning()) return { ok: true };
  try {
    mkdirSync(dirname(ANCHOR_LOG_PATH), { recursive: true });
    // Ensure the log reflects the current run; stale log tails have been a major debugging footgun.
    try {
      writeFileSync(ANCHOR_LOG_PATH, "");
    } catch {
      // ignore
    }
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
        ANCHOR_ORBIT_URL: `ws://127.0.0.1:${PORT}/ws/anchor?anchorId=${encodeURIComponent(ANCHOR_ID)}`,
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

function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function persistTokenToConfigJson(nextToken: string): void {
  if (!CONFIG_JSON_PATH) return;
  try {
    const text = Bun.file(CONFIG_JSON_PATH).textSync();
    const json = JSON.parse(text) as Record<string, unknown>;
    json.token = nextToken;
    Bun.write(CONFIG_JSON_PATH, JSON.stringify(json, null, 2) + "\n");
  } catch {
    // ignore
  }
}

function redactSensitive(text: string): string {
  let out = text;
  if (AUTH_TOKEN) out = out.split(AUTH_TOKEN).join("<redacted-token>");
  // Also redact any obvious 64-hex tokens that might be logged/copied.
  out = out.replace(/\b[a-f0-9]{64}\b/gi, "<redacted-hex>");
  return out;
}

function closeAllSockets(reason: string): void {
  for (const ws of clientSockets.keys()) {
    try {
      ws.close(1000, reason);
    } catch {
      // ignore
    }
  }
  for (const ws of anchorSockets.keys()) {
    try {
      ws.close(1000, reason);
    } catch {
      // ignore
    }
  }
}

function safeExtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "image/svg+xml") return "svg";
  return "bin";
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
  // Some upstreams include thread ids at the top-level (non-RPC envelopes).
  const topLevelCandidates = [(message as any).threadId, (message as any).thread_id];
  for (const c of topLevelCandidates) {
    if (typeof c === "string" && c.trim()) return c;
    if (typeof c === "number") return String(c);
  }

  const params = message.params && typeof message.params === "object" ? (message.params as any) : null;
  const result = message.result && typeof message.result === "object" ? (message.result as any) : null;
  const threadFromParams = params?.thread && typeof params.thread === "object" ? params.thread : null;
  const threadFromTurnParams =
    params?.turn?.thread && typeof params.turn.thread === "object" ? params.turn.thread : null;
  const threadIdFromTurnParams = params?.turn?.threadId ?? params?.turn?.thread_id ?? null;
  const threadIdFromItemParams = params?.item?.threadId ?? params?.item?.thread_id ?? null;
  const threadFromResult = result?.thread && typeof result.thread === "object" ? result.thread : null;
  const threadFromTurnResult =
    result?.turn?.thread && typeof result.turn.thread === "object" ? result.turn.thread : null;
  const threadIdFromTurnResult = result?.turn?.threadId ?? result?.turn?.thread_id ?? null;
  const threadIdFromItemResult = result?.item?.threadId ?? result?.item?.thread_id ?? null;

  const candidates = [
    params?.threadId,
    params?.thread_id,
    threadIdFromTurnParams,
    threadIdFromItemParams,
    result?.threadId,
    result?.thread_id,
    threadIdFromTurnResult,
    threadIdFromItemResult,
    threadFromParams?.id,
    threadFromTurnParams?.id,
    threadFromResult?.id,
    threadFromTurnResult?.id,
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
  const candidates = [
    params?.turnId,
    params?.turn_id,
    params?.turn?.id,
    params?.turn?.turnId,
    params?.turn?.turn_id,
    result?.turnId,
    result?.turn_id,
    result?.turn?.id,
    result?.turn?.turnId,
    result?.turn?.turn_id,
  ];
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

type ThreadTitleMap = Record<string, string>;

function getCodexGlobalStatePath(): string {
  const env = (Bun.env.CODEX_GLOBAL_STATE_JSON || "").trim();
  if (env) return env;
  const home = (Bun.env.HOME || "").trim();
  if (home) return `${home}/.codex/.codex-global-state.json`;
  return ".codex/.codex-global-state.json";
}

let cachedThreadTitles: { path: string; mtimeMs: number; titles: ThreadTitleMap } | null = null;

async function loadCodexThreadTitles(): Promise<ThreadTitleMap> {
  const path = getCodexGlobalStatePath();
  try {
    const st = await Bun.file(path).stat();
    const mtimeMs = st.mtimeMs ?? 0;
    if (cachedThreadTitles && cachedThreadTitles.path === path && cachedThreadTitles.mtimeMs === mtimeMs) {
      return cachedThreadTitles.titles;
    }
    const text = await Bun.file(path).text();
    const json = JSON.parse(text) as any;
    const titles = (json?.["thread-titles"]?.titles ?? json?.thread_titles?.titles ?? {}) as unknown;
    const out: ThreadTitleMap = {};
    if (titles && typeof titles === "object") {
      for (const [k, v] of Object.entries(titles as Record<string, unknown>)) {
        if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
          out[k] = v;
        }
      }
    }
    cachedThreadTitles = { path, mtimeMs, titles: out };
    return out;
  } catch {
    cachedThreadTitles = { path, mtimeMs: 0, titles: {} };
    return {};
  }
}

async function withFileLock(lockPath: string, fn: () => Promise<void>): Promise<void> {
  // Best-effort lock: create file exclusively. Retry briefly if another writer holds it.
  const started = Date.now();
  for (;;) {
    try {
      const f = Bun.file(lockPath);
      // Bun doesn't expose O_EXCL directly; emulate by writing only if missing.
      if (!(await f.exists())) {
        await Bun.write(lockPath, String(process.pid ?? "") + "\n");
        break;
      }
    } catch {
      // ignore
    }
    if (Date.now() - started > 2000) throw new Error("Timed out waiting for title lock");
    await new Promise((r) => setTimeout(r, 75));
  }
  try {
    await fn();
  } finally {
    try {
      await Bun.write(lockPath, ""); // ensure it is writable before unlink attempt on some FS
    } catch {
      // ignore
    }
    try {
      await Bun.file(lockPath).delete();
    } catch {
      // ignore
    }
  }
}

async function setCodexThreadTitle(threadId: string, title: string | null): Promise<void> {
  const path = getCodexGlobalStatePath();
  const lockPath = `${path}.lock`;
  const trimmedId = threadId.trim();
  const trimmedTitle = (title ?? "").trim();
  if (!trimmedId) throw new Error("threadId is required");

  await withFileLock(lockPath, async () => {
    const text = await Bun.file(path).text();
    const json = JSON.parse(text) as Record<string, any>;
    json["thread-titles"] = json["thread-titles"] && typeof json["thread-titles"] === "object" ? json["thread-titles"] : {};
    json["thread-titles"].titles =
      json["thread-titles"].titles && typeof json["thread-titles"].titles === "object" ? json["thread-titles"].titles : {};

    if (!trimmedTitle) {
      // Clear title
      try {
        delete json["thread-titles"].titles[trimmedId];
      } catch {
        // ignore
      }
    } else {
      json["thread-titles"].titles[trimmedId] = trimmedTitle;
      // Keep order list populated so Codex can show "recent" titles deterministically.
      if (!Array.isArray(json["thread-titles"].order)) json["thread-titles"].order = [];
      if (!json["thread-titles"].order.includes(trimmedId)) json["thread-titles"].order.unshift(trimmedId);
    }

    const backupPath = `${path}.bak.${Date.now()}`;
    try {
      await Bun.write(backupPath, text);
    } catch {
      // ignore backup failures
    }
    const tmpPath = `${path}.tmp`;
    await Bun.write(tmpPath, JSON.stringify(json, null, 2) + "\n");
    // Atomic-ish replace
    await Bun.file(tmpPath).rename(path);

    // Invalidate title cache so relays pick up the new title immediately.
    cachedThreadTitles = null;
  });
}

async function injectThreadTitles(msg: Record<string, unknown>): Promise<void> {
  const titles = await loadCodexThreadTitles();
  if (!titles || Object.keys(titles).length === 0) return;

  const method = typeof (msg as any).method === "string" ? ((msg as any).method as string) : null;
  const params = (msg as any).params && typeof (msg as any).params === "object" ? (msg as any).params : null;
  const result = (msg as any).result && typeof (msg as any).result === "object" ? (msg as any).result : null;

  const applyToThread = (t: any) => {
    if (!t || typeof t !== "object") return;
    const id = typeof t.id === "string" ? t.id : typeof t.threadId === "string" ? t.threadId : null;
    if (!id) return;
    const title = titles[id];
    if (!title) return;
    // Only fill if upstream didn't already supply one.
    if (typeof t.title !== "string" || !t.title.trim()) t.title = title;
    if (typeof t.name !== "string" || !t.name.trim()) t.name = title;
    if (typeof t.displayName !== "string" || !t.displayName.trim()) t.displayName = title;
  };

  if (method === "thread/started" && params?.thread) {
    applyToThread(params.thread);
    return;
  }

  // Requests may include `method`, but responses generally don't. Handle both.
  if ((method === "thread/list" || !method) && result?.data && Array.isArray(result.data)) {
    for (const t of result.data) applyToThread(t);
    return;
  }

  if ((method === "thread/get" || !method) && result) {
    if (result.thread) applyToThread(result.thread);
    // Some upstream shapes return the thread object directly
    if (typeof result.id === "string") applyToThread(result);
    return;
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

async function relay(fromRole: Role, msgText: string): Promise<void> {
  const msg = parseJsonMessage(msgText);
  if (!msg) return;

  // Local orbit control messages
  if (typeof msg.type === "string" && (msg.type as string).startsWith("orbit.")) {
    if (msg.type === "orbit.subscribe" && typeof msg.threadId === "string") {
      // handled in ws message handler (needs ws + role)
    }
    return;
  }

  // Best-effort: enrich thread objects with Codex desktop thread titles (if present locally).
  // This keeps Codex Pocket thread list titles in sync with the Codex desktop UI.
  // Only applies for server->client messages, since titles are a presentation concern.
  let msgOut: string = msgText;
  if (fromRole === "anchor") {
    try {
      const cloned = JSON.parse(msgText) as Record<string, unknown>;
      await injectThreadTitles(cloned);
      msgOut = JSON.stringify(cloned);
    } catch {
      // ignore
    }
  }

  const threadId = extractThreadId(msg);
  const targets = fromRole === "client" ? threadToAnchors : threadToClients;

  if (threadId) {
    logEvent(fromRole === "client" ? "client" : "server", fromRole, msgText);
    const set = targets.get(threadId);

    // Important: clients must be able to initiate a thread without an anchor having subscribed yet.
    // If no anchors are subscribed for this thread, fall back to broadcasting to all anchors so the
    // anchor can observe the threadId and subscribe itself.
    if (fromRole === "client" && (!set || set.size === 0)) {
      for (const ws of anchorSockets.keys()) send(ws, msgText);
      return;
    }

    for (const ws of set ?? []) send(ws, msgOut);
    return;
  }

  // If no thread id, broadcast to all opposite-role sockets.
  const all = fromRole === "client" ? anchorSockets : clientSockets;
  logEvent(fromRole === "client" ? "client" : "server", fromRole, msgText);
  for (const ws of all.keys()) send(ws, msgOut);
}

const server = Bun.serve<{ role: Role }>({
  hostname: HOST,
  port: PORT,
	  async fetch(req, server) {
	    const url = new URL(req.url);

    const isHead = req.method === "HEAD";
    const method = isHead ? "GET" : req.method;

    if (method === "GET" && url.pathname === "/health") {
      const distIndexPath = `${UI_DIST_DIR}/index.html`;
      const distIndexExists = await Bun.file(distIndexPath).exists().catch(() => false);
      const res = okJson({
        status: "ok",
        host: HOST,
        port: PORT,
        hostname: hostname(),
        ui: {
          distDir: UI_DIST_DIR,
          indexExists: distIndexExists,
        },
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
      return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }

	    // Admin endpoints (token required)
    if (url.pathname === "/admin/status" && method === "GET") {
      if (!authorised(req)) return unauth();
      const res = okJson({
        server: { host: HOST, port: PORT },
        uiDistDir: UI_DIST_DIR,
        anchor: {
          running: isAnchorRunning(),
          cwd: ANCHOR_CWD,
          host: ANCHOR_HOST,
          port: ANCHOR_PORT,
          log: ANCHOR_LOG_PATH,
        },
        db: { path: DB_PATH, retentionDays: DB_RETENTION_DAYS, uploadDir: UPLOAD_DIR, uploadRetentionDays: UPLOAD_RETENTION_DAYS },
      });
      return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }

    if (url.pathname === "/admin/validate" && method === "GET") {
      if (!authorised(req)) return unauth();
      const origin = requestOrigin(url, req);
      const v = await validateSystem(req, url);
      return okJson({
        ok: v.ok,
        origin,
        server: { host: HOST, port: PORT },
        anchor: { running: isAnchorRunning(), connected: anchorSockets.size > 0, port: ANCHOR_PORT },
        db: { path: DB_PATH, retentionDays: DB_RETENTION_DAYS },
        uploads: { dir: UPLOAD_DIR, retentionDays: UPLOAD_RETENTION_DAYS },
        checks: v.checks,
      });
    }

    if (url.pathname === "/admin/repair" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      const body = (await req.json().catch(() => null)) as null | {
        actions?: string[];
      };
      const actions = Array.isArray(body?.actions) ? body!.actions : [];
      const applied: string[] = [];
      const errors: string[] = [];

      // Keep this conservative: only repair things that are safe and local.
      if (actions.includes("ensureUploadDir")) {
        try {
          await ensureUploadDir();
          applied.push("ensureUploadDir");
          logAdmin("repair: ensured uploads dir exists");
        } catch (e) {
          errors.push(`ensureUploadDir: ${e instanceof Error ? e.message : "failed"}`);
        }
      }

      if (actions.includes("startAnchor")) {
        try {
          const res = startAnchor();
          if (!res.ok) throw new Error(res.error || "failed");
          applied.push("startAnchor");
          logAdmin("repair: started anchor");
        } catch (e) {
          errors.push(`startAnchor: ${e instanceof Error ? e.message : "failed"}`);
        }
      }

      if (actions.includes("pruneUploads")) {
        try {
          await pruneUploads();
          pruneExpiredUploadTokens();
          applied.push("pruneUploads");
          logAdmin("repair: pruned uploads");
        } catch (e) {
          errors.push(`pruneUploads: ${e instanceof Error ? e.message : "failed"}`);
        }
      }

      if (actions.includes("fixTailscaleServe")) {
        try {
          const res = fixTailscaleServe();
          if (!res.ok) throw new Error(res.detail || "failed");
          applied.push("fixTailscaleServe");
          logAdmin("repair: tailscale serve configured");
        } catch (e) {
          errors.push(`fixTailscaleServe: ${e instanceof Error ? e.message : "failed"}`);
        }
      }

      // Re-validate after repairs.
      const v = await validateSystem(req, url);
      const ok = errors.length === 0 && v.ok;
      return okJson({ ok, applied, errors, checks: v.checks });
    }

    if (url.pathname === "/admin/uploads/retention" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      const body = (await req.json().catch(() => null)) as null | { retentionDays?: number };
      const next = Number(body?.retentionDays ?? NaN);
      if (!Number.isFinite(next) || next < 0 || next > 3650) {
        return okJson({ error: "retentionDays must be a number between 0 and 3650" }, { status: 400 });
      }
      UPLOAD_RETENTION_DAYS = next;
      if (CONFIG_JSON_PATH) {
        try {
          const text = Bun.file(CONFIG_JSON_PATH).textSync();
          const json = JSON.parse(text) as Record<string, unknown>;
          json.uploadRetentionDays = next;
          json.uploadDir = UPLOAD_DIR;
          Bun.write(CONFIG_JSON_PATH, JSON.stringify(json, null, 2) + "\n");
        } catch {
          // ignore
        }
      }
      logAdmin(`upload retention set to ${next} day(s)`);
      return okJson({ ok: true, retentionDays: next });
    }

    if (url.pathname === "/admin/uploads/prune" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      // Manual maintenance hook for the admin UI.
      const before = nowSec();
      await pruneUploads();
      pruneExpiredUploadTokens();
      const after = nowSec();
      logAdmin(`upload retention: manual prune completed (${after - before}s)`);
      return okJson({ ok: true });
    }

    if (url.pathname === "/admin/debug/events" && method === "GET") {
      if (!authorised(req)) return unauth();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      try {
        const rows = db
          .prepare("SELECT payload FROM events ORDER BY id DESC LIMIT ?")
          .all(limit) as Array<{ payload: string }>;
        const data = rows
          .map((r) => redactSensitive(r.payload))
          .reverse();
        return okJson({ limit, data });
      } catch {
        return new Response("Failed to query events", { status: 500 });
      }
    }

	    if (url.pathname === "/admin/ops" && method === "GET") {
	      if (!authorised(req)) return unauth();
	      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
	      try {
	        const rows = db
	          .prepare("SELECT payload FROM events WHERE thread_id = ? ORDER BY id DESC LIMIT ?")
	          .all("admin", limit) as Array<{ payload: string }>;
	        const data = rows
	          .map((r) => redactSensitive(r.payload))
	          .reverse();
	        return okJson({ limit, data });
	      } catch {
	        return new Response("Failed to query ops log", { status: 500 });
	      }
	    }

	    if (url.pathname === "/admin/thread/title" && req.method === "POST") {
	      if (!authorised(req)) return unauth();
	      const body = (await req.json().catch(() => null)) as null | {
	        threadId?: string;
	        title?: string | null;
	      };
	      const threadId = (body?.threadId ?? "").trim();
	      const title = body?.title ?? null;
	      if (!threadId) return okJson({ error: "threadId is required" }, { status: 400 });
	      try {
	        await setCodexThreadTitle(threadId, title);
	        logAdmin(`thread title set: ${threadId} -> ${typeof title === "string" ? JSON.stringify(title) : "null"}`);
	        return okJson({ ok: true });
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : "failed to set thread title";
	        return okJson({ error: msg }, { status: 500 });
	      }
	    }

		    if (url.pathname === "/admin/token/rotate" && req.method === "POST") {
	      if (!authorised(req)) return unauth();
	      const next = randomTokenHex(32);

      // Update in-memory token and persist to config.json if available.
      AUTH_TOKEN = next;
      persistTokenToConfigJson(next);

      // Invalidate pairing codes minted under the old token.
      pairCodes.clear();

      // Force connected clients/anchors to reconnect and re-auth with the new token.
      closeAllSockets("token rotated");

	      return okJson({ ok: true, token: next });
	    }

	    // Uploads (token required)
		    if (url.pathname === "/uploads/new" && req.method === "POST") {
		      if (!authorised(req)) return unauth();
		      const body = (await req.json().catch(() => null)) as null | {
		        filename?: string;
		        mime?: string;
		        bytes?: number;
		      };
		      const originalFilename = (body?.filename ?? "").trim();
		      const mime = (body?.mime ?? "").trim() || "application/octet-stream";
		      const bytes = Number(body?.bytes ?? 0);
		      if (!Number.isFinite(bytes) || bytes <= 0) {
		        return okJson({ error: "bytes is required" }, { status: 400 });
		      }
	      if (bytes > UPLOAD_MAX_BYTES) {
	        return okJson({
	          error: `file too large (max ${UPLOAD_MAX_BYTES} bytes)`,
	        }, { status: 413 });
	      }
	      const token = randomTokenHex(16);
	      const ext = safeExtFromMime(mime);
	      const fileName = `${token}.${ext}`;
	      const filePath = join(UPLOAD_DIR, fileName);
	      const createdAt = nowSec();
	      const ttl =
	        Number.isFinite(UPLOAD_RETENTION_DAYS) && UPLOAD_RETENTION_DAYS > 0
	          ? UPLOAD_RETENTION_DAYS * 24 * 60 * 60
	          : 10 * 365 * 24 * 60 * 60;
	      const expiresAt = createdAt + Math.max(ttl, UPLOAD_URL_TTL_SEC);

	      try {
	        await ensureUploadDir();
	        insertUploadToken.run(token, filePath, mime, bytes, createdAt, expiresAt);
	      } catch {
	        return okJson({ error: "failed to create upload token" }, { status: 500 });
	      }

		      const origin = requestOrigin(url, req);
		      return okJson({
		        token,
		        uploadUrl: `${origin}/uploads/${encodeURIComponent(token)}`,
		        viewUrl: `${origin}/u/${encodeURIComponent(token)}`,
		        // This is the local absolute path on the Mac. It's only returned to authorised clients.
		        // Used to pass image pixels to Codex app-server as a file attachment.
		        localPath: filePath,
		        filename: originalFilename || fileName,
		        mime,
		        expiresAt: expiresAt * 1000,
		      });
		    }

	    if (url.pathname.startsWith("/uploads/") && req.method === "PUT") {
	      if (!authorised(req)) return unauth();
	      const token = url.pathname.split("/").filter(Boolean)[1] ?? "";
	      if (!token) return new Response("Not found", { status: 404 });
	      const rec = (getUploadToken.get(token) as any) as null | {
	        token: string;
	        path: string;
	        mime: string;
	        bytes: number;
	        created_at: number;
	        expires_at: number;
	      };
	      if (!rec) return new Response("invalid upload token", { status: 400 });
	      if (nowSec() > rec.expires_at) {
	        deleteUploadToken.run(token);
	        return new Response("upload token expired", { status: 400 });
	      }
	      const ct = (req.headers.get("content-type") ?? "").trim() || rec.mime;
	      if (ct && rec.mime && ct !== rec.mime) {
	        return new Response("content-type mismatch", { status: 400 });
	      }
	      const buf = await req.arrayBuffer();
	      if (buf.byteLength > UPLOAD_MAX_BYTES) {
	        return new Response("file too large", { status: 413 });
	      }
	      try {
	        await ensureUploadDir();
	        await Bun.write(rec.path, new Uint8Array(buf));
	        logAdmin(`upload: saved ${basename(rec.path)} (${buf.byteLength} bytes)`);
	      } catch {
	        return new Response("failed to write upload", { status: 500 });
	      }
	      return okJson({ ok: true, url: `/u/${encodeURIComponent(token)}` });
	    }

	    if (url.pathname.startsWith("/u/") && method === "GET") {
	      const token = url.pathname.split("/").filter(Boolean)[1] ?? "";
	      if (!token) return new Response("Not found", { status: 404 });
	      const rec = (getUploadToken.get(token) as any) as null | {
	        path: string;
	        mime: string;
	        expires_at: number;
	      };
	      if (!rec) return new Response("Not found", { status: 404 });
	      if (nowSec() > rec.expires_at) {
	        deleteUploadToken.run(token);
	        return new Response("Not found", { status: 404 });
	      }
	      const file = Bun.file(rec.path);
	      if (!(await file.exists().catch(() => false))) {
	        return new Response("Not found", { status: 404 });
	      }
	      return new Response(file, {
	        status: 200,
	        headers: {
	          "content-type": rec.mime || "application/octet-stream",
	          "cache-control": "private, max-age=31536000, immutable",
	        },
	      });
	    }

    if (url.pathname === "/admin/pair/new" && req.method === "POST") {
      if (!authorised(req)) return unauth();
      prunePairCodes();
      const code = randomPairCode();
      const expiresAt = Date.now() + PAIR_TTL_SEC * 1000;
      pairCodes.set(code, { token: AUTH_TOKEN, expiresAt });
      const origin = requestOrigin(url, req);
      return okJson({
        code,
        expiresAt,
        pairUrl: `${origin}/pair?code=${encodeURIComponent(code)}`,
      });
    }

    if (url.pathname === "/admin/pair/qr.svg" && method === "GET") {
      if (!authorised(req)) return unauth();
      prunePairCodes();
      const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
      if (!code) return new Response("code is required", { status: 400 });
      const rec = pairCodes.get(code);
      if (!rec || Date.now() > rec.expiresAt) return new Response("invalid or expired code", { status: 400 });
      const payloadUrl = `${requestOrigin(url, req)}/pair?code=${encodeURIComponent(code)}`;
      try {
        const svg = await QRCode.toString(payloadUrl, { type: "svg", margin: 1, width: 260, errorCorrectionLevel: "M" });
        const headers = { "content-type": "image/svg+xml" };
        return isHead ? new Response(null, { status: 200, headers }) : new Response(svg, { status: 200, headers });
      } catch (e) {
        return new Response(e instanceof Error ? e.message : "failed to render qr", { status: 500 });
      }
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

    if (url.pathname === "/admin/logs" && method === "GET") {
      if (!authorised(req)) return unauth();
      const svc = url.searchParams.get("service") ?? "anchor";
      if (svc !== "anchor") return new Response("Not found", { status: 404 });
      // Use Bun.file for simplicity; admin UI only needs tail-ish.
      const res = new Response(Bun.file(ANCHOR_LOG_PATH), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
      return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }

    // Compatibility endpoint for the existing web client.
    // Returns NDJSON of stored events (one JSON object per line).
    if (req.method === "GET" && url.pathname.startsWith("/threads/") && url.pathname.endsWith("/events")) {
      if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
      const parts = url.pathname.split("/").filter(Boolean);
      const threadId = parts.length === 3 ? parts[1] : null;
      if (!threadId) return new Response("Not found", { status: 404 });

      try {
        // IMPORTANT: threads can have very large event logs (e.g. repeated `thread/get` results).
        // To keep mobile clients responsive, allow limiting + reversing the result set.
        const limitRaw = url.searchParams.get("limit");
        const limit =
          limitRaw && /^[0-9]+$/.test(limitRaw) ? Math.max(0, Math.min(5000, Number(limitRaw))) : null;
        const order = (url.searchParams.get("order") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

        const rows = (
          limit != null
            ? db
                .prepare(`SELECT payload FROM events WHERE thread_id = ? ORDER BY id ${order} LIMIT ?`)
                .all(threadId, limit)
            : db.prepare(`SELECT payload FROM events WHERE thread_id = ? ORDER BY id ${order}`).all(threadId)
        ) as Array<{ payload: string }>;
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
      const anchorId =
        role === "anchor" ? (url.searchParams.get("anchorId") || url.searchParams.get("anchor_id")) : null;

      if (server.upgrade(req, { data: { role, ...(anchorId ? { anchorId } : {}) } as any })) {
        return new Response(null, { status: 101 });
      }
      return new Response("Upgrade required", { status: 426 });
    }

    // Static UI (built with Vite) + SPA fallback.
    // This lets a single process serve both the UI and the local services.
    if (method === "GET") {
      try {
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = `${UI_DIST_DIR}${path}`;
        const file = Bun.file(filePath);
        if (await file.exists()) {
          const ct = contentTypeForPath(path);
          const init = ct ? { headers: { "content-type": ct } } : undefined;
          return isHead ? new Response(null, { status: 200, headers: (init as any)?.headers }) : new Response(file, init);
        }
      } catch {
        // fall through
      }
      // SPA fallback: serve index.html for non-file paths.
      try {
        const index = Bun.file(`${UI_DIST_DIR}/index.html`);
        if (await index.exists()) {
          const headers = { "content-type": "text/html; charset=utf-8" };
          return isHead ? new Response(null, { status: 200, headers }) : new Response(index, { headers });
        }
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
        const stableId = typeof (ws.data as any)?.anchorId === "string" ? ((ws.data as any).anchorId as string) : "";
        const meta: AnchorMeta = {
          // Stable id (preferred) so reconnects don't create duplicate devices.
          // Fallback to "pending" until we learn hostname/platform (anchor.hello).
          id: stableId.trim() ? stableId.trim() : "pending",
          hostname: "unknown",
          platform: "unknown",
          connectedAt: new Date().toISOString(),
        };
        // If an anchor reconnects using the same stable id, close the previous socket.
        if (stableId.trim()) {
          for (const existing of anchorMeta.keys()) {
            if (existing === ws) continue;
            const em = anchorMeta.get(existing);
            if (em?.id === stableId.trim()) {
              try {
                existing.close(1000, "replaced");
              } catch {
                // ignore
              }
            }
          }
        }
        anchorMeta.set(ws, meta);
        broadcastToClients({ type: "orbit.anchor-connected", anchor: meta });
      }
    },
    async message(ws, message) {
      const role = ws.data.role;
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);

      // Handle control messages
      const obj = parseJsonMessage(text);
      if (obj?.type === "ping") {
        // Heartbeat from browser. Must be handled even though it's not an orbit.* message.
        send(ws, { type: "pong" });
        return;
      }
      if (obj && typeof obj.type === "string" && (obj.type as string).startsWith("orbit.")) {
        if (obj.type === "orbit.subscribe" && typeof obj.threadId === "string") {
          subscribe(role, ws, obj.threadId);
          return;
        }
        if (obj.type === "orbit.list-anchors") {
          send(ws, { type: "orbit.anchors", anchors: listAnchors() });
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
          // Only derive an id from hostname/platform if we don't already have a stable id.
          if (meta.id === "pending" && (meta.hostname !== "unknown" || meta.platform !== "unknown")) {
            meta.id = `${meta.hostname}:${meta.platform}`;
          }
          broadcastToClients({ type: "orbit.anchor-connected", anchor: meta });
        }
        return;
      }

      await relay(role, text);
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
          // Client expects anchorId for removal.
          broadcastToClients({ type: "orbit.anchor-disconnected", anchorId: meta.id, anchor: meta });
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
