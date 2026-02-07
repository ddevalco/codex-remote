import { hostname, homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { dirname } from "node:path";

// Anchor does not need to bind a local HTTP server. Its job is to:
// 1) spawn `codex app-server`
// 2) connect to local-orbit via WebSocket and relay messages
//
// Older versions exposed a local health endpoint and bound to ANCHOR_PORT. That caused frequent
// EADDRINUSE conflicts (and broke "No device connected" UX). We keep these env vars for logging only.
const PORT = Number(process.env.ANCHOR_PORT ?? 8788);
const HOST = process.env.ANCHOR_HOST ?? "127.0.0.1";
const ORBIT_URL = process.env.ANCHOR_ORBIT_URL ?? "";
const ANCHOR_APP_CWD = process.env.ANCHOR_APP_CWD ?? process.cwd();
const ANCHOR_JWT_TTL_SEC = Number(process.env.ANCHOR_JWT_TTL_SEC ?? 300);
const AUTH_URL = process.env.AUTH_URL ?? "";
const FORCE_LOGIN = process.env.ZANE_FORCE_LOGIN === "1";
const CREDENTIALS_FILE = process.env.ZANE_CREDENTIALS_FILE ?? "";

let ZANE_ANCHOR_JWT_SECRET = "";
let USER_ID: string | undefined;

const MAX_SUBSCRIBED_THREADS = 1000;
const subscribedThreads = new Set<string>();
let appServer: Bun.Subprocess | null = null;
let appServerStarting = false;
let orbitSocket: WebSocket | null = null;
let orbitConnecting = false;
let orbitHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let orbitHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
let warnedNoAppServer = false;
let appServerInitialized = false;

// Buffer pending approval requests from app-server so we can re-send them
// when a client (re)subscribes to a thread via orbit.
const APPROVAL_METHODS = new Set([
  "item/fileChange/requestApproval",
  "item/commandExecution/requestApproval",
  "item/mcpToolCall/requestApproval",
  "item/tool/requestUserInput",
]);
const pendingApprovals = new Map<string, string>(); // threadId → raw JSON line
const approvalRpcIds = new Map<number | string, string>(); // rpcId → threadId (for cleanup on response)

async function handleListDirs(
  id: number | string,
  params: JsonObject | null,
): Promise<JsonObject> {
  const raw = params?.path;
  const targetPath = typeof raw === "string" && raw.trim() ? raw.trim() : homedir();
  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    return { id, result: { dirs, parent: dirname(targetPath), current: targetPath } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list directory";
    return { id, error: { code: -1, message } };
  }
}

function ensureAppServer(): void {
  if (appServer || appServerStarting) return;
  appServerStarting = true;

  try {
    appServer = Bun.spawn({
      cmd: ["codex", "app-server"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    warnedNoAppServer = false;
    appServerInitialized = false;
    initializeAppServer();

    appServer.exited.then((code) => {
      console.warn(`[anchor] app-server exited with code ${code}`);
      appServer = null;
      appServerInitialized = false;
      pendingApprovals.clear();
      approvalRpcIds.clear();
    });

    streamLines(appServer.stdout, (line) => {
      // Auto-subscribe to threads from app-server messages
      const parsed = parseJsonRpcMessage(line);
      if (parsed) {
        const threadId = extractThreadId(parsed);
        if (threadId) {
          subscribeToThread(threadId);
        }

        // Buffer pending approval requests; clear on turn/completed or response
        const method = parsed.method as string | undefined;
        if (method && APPROVAL_METHODS.has(method) && threadId) {
          pendingApprovals.set(threadId, line);
          const rpcId = parsed.id as number | string | undefined;
          if (rpcId != null) approvalRpcIds.set(rpcId, threadId);
        } else if (method === "turn/completed" && threadId) {
          pendingApprovals.delete(threadId);
        }
      }

      // Relay app-server output back to local-orbit (and thus to browsers).
      if (orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
        try {
          orbitSocket.send(line);
        } catch (err) {
          console.warn("[anchor] failed to relay app-server output to orbit", err);
        }
      }
    });

    streamLines(appServer.stderr, (line) => {
      console.error(`[app-server] ${line}`);
    });
  } catch (err) {
    console.error("[anchor] failed to start codex app-server", err);
    appServer = null;
  } finally {
    appServerStarting = false;
  }
}

function initializeAppServer(): void {
  if (appServerInitialized) return;
  const initPayload = JSON.stringify({
    method: "initialize",
    id: Date.now(),
    params: {
      cwd: ANCHOR_APP_CWD,
      clientInfo: {
        name: "zane-anchor",
        version: "dev",
        platform: process.platform,
      },
    },
  });
  console.log(`[anchor] app-server initialize: cwd=${ANCHOR_APP_CWD}`);
  sendToAppServer(initPayload + "\n");
  appServerInitialized = true;
}

function isWritableStream(input: unknown): input is WritableStream<Uint8Array> {
  return typeof (input as WritableStream<Uint8Array>)?.getWriter === "function";
}

function isFileSink(input: unknown): input is { write: (data: string | Uint8Array) => void } {
  return typeof (input as { write?: unknown })?.write === "function";
}

function sendToAppServer(payload: string): void {
  if (!appServer || appServer.stdin === undefined || typeof appServer.stdin === "number") {
    if (!warnedNoAppServer) {
      console.warn("[anchor] app-server not running; cannot forward payload");
      warnedNoAppServer = true;
    }
    return;
  }

  const stdin = appServer.stdin;
  if (isWritableStream(stdin)) {
    const writer = stdin.getWriter();
    writer.write(new TextEncoder().encode(payload));
    writer.releaseLock();
    return;
  }
  if (isFileSink(stdin)) {
    stdin.write(payload);
  }
}

type JsonObject = Record<string, unknown>;

function parseJsonRpcMessage(payload: string): JsonObject | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as JsonObject;
    if ("method" in parsed || "id" in parsed) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function asRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function extractThreadId(message: JsonObject): string | null {
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const threadFromParams = asRecord(params?.thread);
  const threadFromResult = asRecord(result?.thread);

  const candidates = [
    params?.threadId,
    params?.thread_id,
    result?.threadId,
    result?.thread_id,
    threadFromParams?.id,
    threadFromResult?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }

  return null;
}

function subscribeToThread(threadId: string): void {
  if (subscribedThreads.has(threadId)) return;
  if (!orbitSocket || orbitSocket.readyState !== WebSocket.OPEN) return;

  subscribedThreads.add(threadId);
  if (subscribedThreads.size > MAX_SUBSCRIBED_THREADS) {
    const oldest = subscribedThreads.values().next().value;
    if (oldest) subscribedThreads.delete(oldest);
  }
  try {
    orbitSocket.send(JSON.stringify({ type: "orbit.subscribe", threadId }));
    console.log(`[anchor] subscribed to thread ${threadId}`);
  } catch (err) {
    console.warn("[anchor] failed to subscribe to thread", err);
    subscribedThreads.delete(threadId);
  }
}

function resubscribeAllThreads(): void {
  if (!orbitSocket || orbitSocket.readyState !== WebSocket.OPEN) return;

  for (const threadId of subscribedThreads) {
    try {
      orbitSocket.send(JSON.stringify({ type: "orbit.subscribe", threadId }));
    } catch (err) {
      console.warn("[anchor] failed to resubscribe to thread", err);
    }
  }

  if (subscribedThreads.size > 0) {
    console.log(`[anchor] resubscribed to ${subscribedThreads.size} thread(s)`);
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwtHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encoder = new TextEncoder();
  const headerPart = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const data = encoder.encode(`${headerPart}.${payloadPart}`);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const signaturePart = base64UrlEncode(signature);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

async function buildOrbitUrl(): Promise<string | null> {
  if (!ORBIT_URL) return null;
  try {
    const url = new URL(ORBIT_URL);
    // Local-Orbit mode: if connecting to a non-TLS ws:// URL on localhost, treat
    // ZANE_ANCHOR_JWT_SECRET as a shared bearer token (not a JWT).
    //
    // This lets users run the stack entirely on their Mac and expose it via
    // Tailscale (tailscale serve) without Cloudflare.
    if (ZANE_ANCHOR_JWT_SECRET) {
      if (url.protocol === "ws:" && url.hostname === "127.0.0.1") {
        url.searchParams.set("token", ZANE_ANCHOR_JWT_SECRET);
      } else {
        const now = Math.floor(Date.now() / 1000);
        const token = await signJwtHs256(
          {
            iss: "zane-anchor",
            aud: "zane-orbit-anchor",
            sub: USER_ID,
            iat: now,
            exp: now + ANCHOR_JWT_TTL_SEC,
          },
          ZANE_ANCHOR_JWT_SECRET
        );
        url.searchParams.set("token", token);
      }
    }
    return url.toString();
  } catch (err) {
    console.error("[anchor] invalid ANCHOR_ORBIT_URL", err);
    return null;
  }
}

function stopOrbitHeartbeat(): void {
  if (orbitHeartbeatInterval) {
    clearInterval(orbitHeartbeatInterval);
    orbitHeartbeatInterval = null;
  }
  if (orbitHeartbeatTimeout) {
    clearTimeout(orbitHeartbeatTimeout);
    orbitHeartbeatTimeout = null;
  }
}

function startOrbitHeartbeat(ws: WebSocket): void {
  stopOrbitHeartbeat();
  orbitHeartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
        orbitHeartbeatTimeout = setTimeout(() => {
          console.warn("[anchor] heartbeat timeout");
          ws.close();
        }, 10_000);
      } catch {
        ws.close();
      }
    }
  }, 30_000);
}

async function connectOrbit(): Promise<void> {
  let url: string | null = null;
  try {
    url = await buildOrbitUrl();
  } catch (err) {
    console.error("[anchor] failed to build orbit url", err);
  }
  if (!url) return;
  if (orbitSocket && orbitSocket.readyState !== WebSocket.CLOSED) return;
  if (orbitConnecting) return;

  orbitConnecting = true;
  const ws = new WebSocket(url);
  orbitSocket = ws;

  ws.addEventListener("open", () => {
    orbitConnecting = false;
    ws.send(JSON.stringify({
      type: "anchor.hello",
      ts: new Date().toISOString(),
      hostname: hostname(),
      platform: process.platform,
    }));
    console.log("[anchor] connected to orbit");
    startOrbitHeartbeat(ws);
    resubscribeAllThreads();
  });

  ws.addEventListener("message", (event) => {
    const text =
      typeof event.data === "string"
        ? event.data
        : event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data)
          : new TextDecoder().decode(event.data as ArrayBuffer);

    if (text === '{"type":"pong"}') {
      if (orbitHeartbeatTimeout) {
        clearTimeout(orbitHeartbeatTimeout);
        orbitHeartbeatTimeout = null;
      }
      return;
    }

    // Handle orbit protocol messages
    try {
      const parsed = JSON.parse(text) as JsonObject;
      if (typeof parsed.type === "string" && (parsed.type as string).startsWith("orbit.")) {
        // Client (re)subscribed — re-send any pending approval for this thread
        if (parsed.type === "orbit.client-subscribed" && typeof parsed.threadId === "string") {
          const buffered = pendingApprovals.get(parsed.threadId);
          if (buffered && orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
            // Tag as replay so orbit relays but doesn't double-store
            try {
              const bufferedMsg = JSON.parse(buffered);
              bufferedMsg._replay = true;
              orbitSocket.send(JSON.stringify(bufferedMsg));
            } catch {
              orbitSocket.send(buffered);
            }
            console.log(`[anchor] re-sent pending approval for thread ${parsed.threadId}`);
          }
        }
        return;
      }
    } catch {
      // Not JSON, continue
    }

    // Handle anchor-local RPC methods from orbit-relayed messages
    const message = parseJsonRpcMessage(text);
    if (message && message.method === "anchor.listDirs" && message.id != null) {
      void handleListDirs(message.id as number | string, asRecord(message.params)).then((resp) => {
        if (orbitSocket && orbitSocket.readyState === WebSocket.OPEN) {
          try { orbitSocket.send(JSON.stringify(resp)); } catch { /* ignore */ }
        }
      });
      return;
    }

    ensureAppServer();
    if (message && ("method" in message || "id" in message)) {
      // Auto-subscribe to threads from orbit messages
      const threadId = extractThreadId(message);
      if (threadId) {
        subscribeToThread(threadId);
      }

      // Clear pending approval when the client's response arrives
      const rpcId = message.id as number | string | undefined;
      if (rpcId != null && "result" in message && approvalRpcIds.has(rpcId)) {
        const approvalThread = approvalRpcIds.get(rpcId)!;
        pendingApprovals.delete(approvalThread);
        approvalRpcIds.delete(rpcId);
      }

      sendToAppServer(text.trim() + "\n");
    }
  });

  ws.addEventListener("close", () => {
    stopOrbitHeartbeat();
    orbitSocket = null;
    orbitConnecting = false;
    setTimeout(() => void connectOrbit(), 2_000);
  });

  ws.addEventListener("error", () => {
    stopOrbitHeartbeat();
    orbitSocket = null;
    orbitConnecting = false;
  });
}

async function streamLines(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  onLine: (line: string) => void
): Promise<void> {
  if (!stream || typeof stream === "number") return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.length === 0) continue;
      onLine(part);
    }
  }

  const tail = buffer.trim();
  if (tail.length > 0) onLine(tail);
}

interface Credentials {
  anchorJwtSecret: string;
  userId: string;
}

async function loadCredentials(): Promise<Credentials | null> {
  if (!CREDENTIALS_FILE) return null;
  try {
    const text = await Bun.file(CREDENTIALS_FILE).text();
    const data = JSON.parse(text) as Partial<Credentials>;
    if (data.anchorJwtSecret && data.userId) {
      return { anchorJwtSecret: data.anchorJwtSecret, userId: data.userId };
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

async function saveCredentials(creds: Credentials): Promise<void> {
  if (!CREDENTIALS_FILE) return;
  try {
    await Bun.write(CREDENTIALS_FILE, JSON.stringify(creds, null, 2) + "\n");
    const { chmod } = await import("node:fs/promises");
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch (err) {
    console.warn("[anchor] could not save credentials", err);
  }
}

async function deviceLogin(): Promise<boolean> {
  if (!AUTH_URL) {
    console.error("[anchor] AUTH_URL is required for device login");
    return false;
  }

  console.log("\n  Sign in to connect to Orbit:\n");

  try {
    const codeRes = await fetch(`${AUTH_URL}/auth/device/code`, { method: "POST" });
    if (!codeRes.ok) {
      console.error("[anchor] failed to request device code");
      return false;
    }

    const codeData = (await codeRes.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      expiresIn: number;
      interval: number;
    };

    console.log(`    ${codeData.verificationUrl}\n`);
    console.log(`  Enter code: \x1b[1m${codeData.userCode}\x1b[0m\n`);

    // Try to open browser
    try {
      Bun.spawn(["open", codeData.verificationUrl]);
    } catch {
      // Ignore — user can open manually
    }

    console.log("  Waiting for authorisation...");

    const deadline = Date.now() + codeData.expiresIn * 1000;
    const interval = codeData.interval * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));

      const tokenRes = await fetch(`${AUTH_URL}/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: codeData.deviceCode }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text().catch(() => "");
        console.error(`  [anchor] poll error (${tokenRes.status}): ${errBody}`);
        continue;
      }

      const tokenData = (await tokenRes.json()) as {
        status: "pending" | "authorised" | "expired";
        userId?: string;
        anchorJwtSecret?: string;
      };

      if (tokenData.status === "pending") continue;

      if (tokenData.status === "authorised" && tokenData.userId && tokenData.anchorJwtSecret) {
        ZANE_ANCHOR_JWT_SECRET = tokenData.anchorJwtSecret;
        USER_ID = tokenData.userId;

        await saveCredentials({ anchorJwtSecret: ZANE_ANCHOR_JWT_SECRET, userId: USER_ID });

        console.log("  \x1b[32mAuthorised!\x1b[0m Credentials saved.\n");
        return true;
      }

      // expired
      console.error("  Code expired. Run 'zane login' to try again.");
      return false;
    }

    console.error("  Timed out. Run 'zane login' to try again.");
    return false;
  } catch (err) {
    console.error("[anchor] device login failed", err);
    return false;
  }
}

console.log(`[anchor] starting (local listen disabled) host=${HOST} port=${PORT}`);

async function startup() {
  const saved = await loadCredentials();
  if (saved) {
    ZANE_ANCHOR_JWT_SECRET = saved.anchorJwtSecret;
    USER_ID = saved.userId;
  }

  // Local-only mode: when AUTH_URL is unset/empty we cannot do "device login".
  // In that case we treat ZANE_ANCHOR_JWT_SECRET as a shared bearer token (not a JWT)
  // and allow Orbit connection without a USER_ID.
  const canDeviceLogin = Boolean(AUTH_URL);
  if (ORBIT_URL && ZANE_ANCHOR_JWT_SECRET && !USER_ID && !canDeviceLogin) {
    USER_ID = "local";
  }

  const needsLogin =
    Boolean(ORBIT_URL) &&
    ((FORCE_LOGIN && canDeviceLogin) || !ZANE_ANCHOR_JWT_SECRET || (canDeviceLogin && !USER_ID));

console.log(`\nCodex Pocket Anchor`);
  console.log(`  Local:     disabled (no local listen)`);

  if (needsLogin) {
    const ok = await deviceLogin();
    if (!ok) {
      console.log(`  Orbit:     not connected (login required)`);
      console.log();
      return;
    }
  }

  if (ORBIT_URL) {
    console.log(`  Orbit:     ${ORBIT_URL}`);
  } else {
    console.log(`  Orbit:     disabled (local-only mode)`);
  }
  console.log();

  void connectOrbit();
}

void startup();
