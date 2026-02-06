import { sendPush, type PushPayload, type VapidKeys } from "./push";

type Role = "client" | "anchor";
type Direction = "client" | "server";

export interface Env {
  ZANE_WEB_JWT_SECRET?: string;
  ZANE_ANCHOR_JWT_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ALLOWED_ORIGIN?: string;
  DB?: D1Database;
  ORBIT_DO: DurableObjectNamespace;
}

const JWT_ISSUER_WEB = "zane-auth";
const JWT_AUDIENCE_WEB = "zane-web";
const JWT_ISSUER_ANCHOR = "zane-anchor";
const JWT_AUDIENCE_ANCHOR = "zane-orbit-anchor";
const JWT_CLOCK_SKEW_SEC = 30;

function getAuthToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwtPart<T>(part: string): T | null {
  try {
    const text = new TextDecoder().decode(base64UrlToBytes(part));
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function verifyJwtHs256(
  token: string,
  secret: string,
  expected: { issuer: string; audience: string }
): Promise<boolean> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return false;

  const header = parseJwtPart<{ alg?: string }>(headerPart);
  if (!header || header.alg !== "HS256") return false;

  const payload = parseJwtPart<{
    iss?: string;
    aud?: string | string[];
    exp?: number;
  }>(payloadPart);
  if (!payload) return false;
  if (payload.iss !== expected.issuer) return false;
  if (payload.aud) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(expected.audience)) return false;
  }
  if (typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp + JWT_CLOCK_SKEW_SEC) return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToBytes(signaturePart);
  return await crypto.subtle.verify("HMAC", key, signature, data);
}

interface AuthResult {
  authorised: boolean;
  userId: string | null;
  jwtType: "web" | "anchor" | null;
}

function extractJwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parseJwtPart<{ sub?: string }>(parts[1]);
  return payload?.sub ?? null;
}

async function isAuthorised(req: Request, env: Env): Promise<AuthResult> {
  const denied: AuthResult = { authorised: false, userId: null, jwtType: null };

  const userSecret = env.ZANE_WEB_JWT_SECRET?.trim();
  const anchorSecret = env.ZANE_ANCHOR_JWT_SECRET?.trim();
  if (!userSecret && !anchorSecret) {
    console.error("[orbit] auth: no secrets configured, denying request");
    return denied;
  }

  const provided = (getAuthToken(req) ?? "").trim();
  if (!provided) {
    console.warn("[orbit] auth: missing token");
    return denied;
  }

  if (userSecret) {
    const ok = await verifyJwtHs256(provided, userSecret, {
      issuer: JWT_ISSUER_WEB,
      audience: JWT_AUDIENCE_WEB,
    });
    if (ok) {
      const userId = extractJwtSub(provided);
      console.log(`[orbit] auth: web JWT accepted, userId=${userId}`);
      return { authorised: true, userId, jwtType: "web" };
    }
  }

  if (anchorSecret) {
    const ok = await verifyJwtHs256(provided, anchorSecret, {
      issuer: JWT_ISSUER_ANCHOR,
      audience: JWT_AUDIENCE_ANCHOR,
    });
    if (ok) {
      const userId = extractJwtSub(provided);
      console.log(`[orbit] auth: anchor JWT accepted, userId=${userId}`);
      return { authorised: true, userId, jwtType: "anchor" };
    }
  }

  console.warn("[orbit] auth: token rejected");
  return denied;
}

function getRoleFromPath(pathname: string): Role | null {
  if (pathname === "/ws/client") return "client";
  if (pathname === "/ws/anchor") return "anchor";
  return null;
}

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  try {
    if (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) return true;
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowedOrigin = isAllowedOrigin(origin, env) ? origin! : "null";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    vary: "origin",
  };
}


function parseJsonMessage(payload: string): Record<string, unknown> | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractThreadId(message: Record<string, unknown>): string | null {
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

function extractTurnId(message: Record<string, unknown>): string | null {
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const turnFromParams = asRecord(params?.turn);
  const turnFromResult = asRecord(result?.turn);

  const candidates = [params?.turnId, params?.turn_id, turnFromParams?.id, turnFromResult?.id];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }

  return null;
}

function extractMethod(message: Record<string, unknown>): string | null {
  const method = message.method;
  if (typeof method === "string" && method.trim()) return method;
  const type = message.type;
  if (typeof type === "string" && type.trim()) return type;
  return null;
}

const STORED_METHODS = new Set([
  "turn/start",
  "turn/started",
  "turn/completed",
  "turn/diff/updated",
  "item/started",
  "item/completed",
  "item/fileChange/requestApproval",
  "item/commandExecution/requestApproval",
  "item/mcpToolCall/requestApproval",
  "item/tool/requestUserInput",
]);

async function fetchThreadEvents(req: Request, env: Env, origin: string | null, userId: string | null): Promise<Response> {
  if (!env.DB) {
    return new Response("D1 not configured", { status: 501, headers: corsHeaders(origin, env) });
  }
  if (!userId) {
    return new Response("Unauthorised: missing user identity", { status: 401, headers: corsHeaders(origin, env) });
  }
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const threadId = parts.length === 3 ? parts[1] : null;
  if (!threadId) {
    return new Response("Not found", { status: 404, headers: corsHeaders(origin, env) });
  }

  const query = env.DB.prepare("SELECT payload FROM events WHERE thread_id = ? AND user_id = ? ORDER BY id ASC").bind(threadId, userId);
  const { results } = await query.all<{ payload: string }>();
  const lines = results.map((row) => row.payload).join("\n");
  const body = lines ? `${lines}\n` : "";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      ...corsHeaders(origin, env),
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 200 });
    }

    // CORS preflight for REST APIs
    if (req.method === "OPTIONS") {
      if (url.pathname.startsWith("/threads/") && url.pathname.endsWith("/events")) {
        return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
      }
    }

    if (req.method === "GET" && url.pathname.startsWith("/threads/") && url.pathname.endsWith("/events")) {
      const authResult = await isAuthorised(req, env);
      if (!authResult.authorised) {
        console.warn(`[orbit] events auth failed: ${url.pathname}`);
        return new Response("Unauthorised", { status: 401, headers: corsHeaders(origin, env) });
      }
      console.log(`[orbit] events request: ${url.pathname}`);
      return fetchThreadEvents(req, env, origin, authResult.userId);
    }

    const role = getRoleFromPath(url.pathname);
    if (!role) {
      return new Response("Not found", { status: 404 });
    }

    const authResult = await isAuthorised(req, env);
    if (!authResult.authorised) {
      console.warn(`[orbit] ws auth failed: ${url.pathname}`);
      return new Response("Unauthorised", { status: 401 });
    }

    if (!authResult.userId) {
      console.warn(`[orbit] ws auth: no userId in token`);
      return new Response("Unauthorised: missing user identity", { status: 401 });
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }

    console.log(`[orbit] ws upgrade accepted: ${url.pathname} userId=${authResult.userId}`);
    const id = env.ORBIT_DO.idFromName(authResult.userId);
    const stub = env.ORBIT_DO.get(id);
    const nextReq = new Request(req, { headers: new Headers(req.headers) });
    nextReq.headers.set("x-orbit-role", role);
    nextReq.headers.set("x-orbit-user-id", authResult.userId);

    return stub.fetch(nextReq);
  },
};

interface AnchorMeta {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
}

export class OrbitRelay {
  private env: Env;
  private userId: string | null = null;

  // Track rpcIds from approval/user-input requests so we can store their responses
  private pendingRequestRpcIds = new Map<string | number, { threadId: string; method: string }>();

  // Socket -> subscribed thread IDs
  private clientSockets = new Map<WebSocket, Set<string>>();
  private anchorSockets = new Map<WebSocket, Set<string>>();
  private anchorMeta = new Map<WebSocket, AnchorMeta>();
  private clientIdToSocket = new Map<string, WebSocket>();
  private socketToClientId = new Map<WebSocket, string>();

  // Thread ID -> subscribed sockets (reverse index for fast routing)
  private threadToClients = new Map<string, Set<WebSocket>>();
  private threadToAnchors = new Map<string, Set<WebSocket>>();

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env;
  }

  fetch(req: Request): Response {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }

    const role = req.headers.get("x-orbit-role") as Role | null;
    if (role !== "client" && role !== "anchor") {
      return new Response("Missing role", { status: 400 });
    }

    const userId = req.headers.get("x-orbit-user-id");
    if (!userId) {
      return new Response("Missing user identity", { status: 400 });
    }
    this.userId = userId;

    const url = new URL(req.url);
    const clientId = role === "client" ? url.searchParams.get("clientId") : null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    this.registerSocket(server, role, clientId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private registerSocket(socket: WebSocket, role: Role, clientId: string | null): void {
    const source = role === "client" ? this.clientSockets : this.anchorSockets;
    const direction: Direction = role === "client" ? "client" : "server";

    if (role === "client" && clientId) {
      const existing = this.clientIdToSocket.get(clientId);
      if (existing && existing !== socket) {
        this.removeSocket(existing, "client");
        try {
          existing.close(1000, "Replaced by newer connection");
        } catch {
          // ignore
        }
      }
      this.clientIdToSocket.set(clientId, socket);
      this.socketToClientId.set(socket, clientId);
    }

    source.set(socket, new Set());

    socket.send(
      JSON.stringify({
        type: "orbit.hello",
        role,
        ts: new Date().toISOString(),
      })
    );

    socket.addEventListener("message", (event) => {
      if (this.handlePing(socket, event.data)) {
        return;
      }

      const payloadStr = this.dataToString(event.data);
      const parsed = payloadStr ? parseJsonMessage(payloadStr) : null;

      if (this.handleSubscription(socket, role, parsed)) {
        return;
      }

      if (this.handleAnchorHello(socket, role, parsed)) {
        return;
      }

      this.logEvent(event.data, direction);
      this.routeMessage(socket, role, event.data, parsed);
    });

    const cleanup = () => {
      this.removeSocket(socket, role);
      try {
        socket.close();
      } catch {
        // ignore
      }
    };

    socket.addEventListener("close", cleanup);
    socket.addEventListener("error", cleanup);
  }

  private handleSubscription(socket: WebSocket, role: Role, msg: Record<string, unknown> | null): boolean {
    if (!msg) return false;

    if (msg.type === "orbit.subscribe" && typeof msg.threadId === "string") {
      this.subscribeSocket(socket, role, msg.threadId);
      try {
        socket.send(JSON.stringify({ type: "orbit.subscribed", threadId: msg.threadId }));
      } catch {
        // ignore
      }
      console.log(`[orbit] ${role} subscribed to thread ${msg.threadId}`);

      // Notify anchors so they can re-send any pending approval from memory
      if (role === "client") {
        const notification = JSON.stringify({ type: "orbit.client-subscribed", threadId: msg.threadId });
        const anchors = this.threadToAnchors.get(msg.threadId);
        if (anchors) {
          for (const anchor of anchors) {
            try { anchor.send(notification); } catch { /* ignore */ }
          }
        }
      }

      return true;
    }

    if (msg.type === "orbit.unsubscribe" && typeof msg.threadId === "string") {
      this.unsubscribeSocket(socket, role, msg.threadId);
      console.log(`[orbit] ${role} unsubscribed from thread ${msg.threadId}`);
      return true;
    }

    if (msg.type === "orbit.list-anchors" && role === "client") {
      const anchors = Array.from(this.anchorMeta.values());
      try {
        socket.send(JSON.stringify({ type: "orbit.anchors", anchors }));
      } catch {
        // ignore
      }
      return true;
    }

    if (msg.type === "orbit.push-subscribe" && role === "client") {
      this.savePushSubscription(msg);
      return true;
    }

    if (msg.type === "orbit.push-unsubscribe" && role === "client") {
      this.removePushSubscription(msg);
      return true;
    }

    if (msg.type === "orbit.push-test" && role === "client") {
      this.sendTestPush(socket);
      return true;
    }

    return false;
  }

  private handleAnchorHello(socket: WebSocket, role: Role, msg: Record<string, unknown> | null): boolean {
    if (!msg || role !== "anchor" || msg.type !== "anchor.hello") return false;

    const meta: AnchorMeta = {
      id: crypto.randomUUID(),
      hostname: typeof msg.hostname === "string" ? msg.hostname : "unknown",
      platform: typeof msg.platform === "string" ? msg.platform : "unknown",
      connectedAt: typeof msg.ts === "string" ? msg.ts : new Date().toISOString(),
    };

    this.anchorMeta.set(socket, meta);

    const notification = JSON.stringify({ type: "orbit.anchor-connected", anchor: meta });
    for (const clientSocket of this.clientSockets.keys()) {
      try {
        clientSocket.send(notification);
      } catch {
        // ignore
      }
    }

    return true;
  }

  private subscribeSocket(socket: WebSocket, role: Role, threadId: string): void {
    const socketThreads = role === "client"
      ? this.clientSockets.get(socket)
      : this.anchorSockets.get(socket);

    if (socketThreads) {
      socketThreads.add(threadId);
    }

    const threadSockets = role === "client" ? this.threadToClients : this.threadToAnchors;
    if (!threadSockets.has(threadId)) {
      threadSockets.set(threadId, new Set());
    }
    threadSockets.get(threadId)!.add(socket);
  }

  private unsubscribeSocket(socket: WebSocket, role: Role, threadId: string): void {
    const socketThreads = role === "client"
      ? this.clientSockets.get(socket)
      : this.anchorSockets.get(socket);

    if (socketThreads) {
      socketThreads.delete(threadId);
    }

    const threadSockets = role === "client" ? this.threadToClients : this.threadToAnchors;
    const sockets = threadSockets.get(threadId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        threadSockets.delete(threadId);
      }
    }
  }

  private removeSocket(socket: WebSocket, role: Role): void {
    const source = role === "client" ? this.clientSockets : this.anchorSockets;
    const threadSockets = role === "client" ? this.threadToClients : this.threadToAnchors;

    const threads = source.get(socket);
    if (threads) {
      for (const threadId of threads) {
        const sockets = threadSockets.get(threadId);
        if (sockets) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            threadSockets.delete(threadId);
          }
        }
      }
    }

    source.delete(socket);

    if (role === "client") {
      const clientId = this.socketToClientId.get(socket);
      if (clientId) {
        this.socketToClientId.delete(socket);
        if (this.clientIdToSocket.get(clientId) === socket) {
          this.clientIdToSocket.delete(clientId);
        }
      }
    }

    if (role === "anchor") {
      const meta = this.anchorMeta.get(socket);
      if (meta) {
        this.anchorMeta.delete(socket);
        const notification = JSON.stringify({ type: "orbit.anchor-disconnected", anchorId: meta.id });
        for (const clientSocket of this.clientSockets.keys()) {
          try {
            clientSocket.send(notification);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  private routeMessage(socket: WebSocket, role: Role, data: string | ArrayBuffer | ArrayBufferView, msg: Record<string, unknown> | null): void {
    const threadId = msg ? extractThreadId(msg) : null;

    if (role === "client") {
      // TODO: broadcasts to all anchors — won't scale if multiple anchors serve distinct threads
      for (const target of this.anchorSockets.keys()) {
        try {
          target.send(data);
        } catch (err) {
          console.warn("[orbit] failed to relay message", err);
        }
      }
    } else {
      // Anchor → client: thread-scoped messages go to subscribers only
      if (threadId) {
        const targets = this.threadToClients.get(threadId);
        if (targets && targets.size > 0) {
          for (const target of targets) {
            try {
              target.send(data);
            } catch (err) {
              console.warn("[orbit] failed to relay message", err);
            }
          }
        } else {
          // No subscribers yet (e.g. thread/start response) — broadcast to all clients
          for (const target of this.clientSockets.keys()) {
            try {
              target.send(data);
            } catch (err) {
              console.warn("[orbit] failed to relay message", err);
            }
          }
        }
      } else {
        // No threadId — broadcast to all clients
        for (const target of this.clientSockets.keys()) {
          try {
            target.send(data);
          } catch (err) {
            console.warn("[orbit] failed to relay message", err);
          }
        }
      }

      // Send push notification for blocking events (async, non-blocking)
      if (msg) {
        const method = extractMethod(msg);
        if (method && this.isPushWorthy(method)) {
          this.sendPushNotifications(msg, method, threadId);
        }
      }
    }
  }

  private dataToString(data: unknown): string | null {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (data instanceof Uint8Array) return new TextDecoder().decode(data);
    return null;
  }

  private handlePing(socket: WebSocket, data: unknown): boolean {
    const payload = this.dataToString(data);
    if (!payload) return false;

    const trimmed = payload.trim();
    if (trimmed === '{"type":"ping"}') {
      try {
        socket.send(JSON.stringify({ type: "pong" }));
      } catch {}
      return true;
    }

    return false;
  }

  private isPushWorthy(method: string): boolean {
    return method.endsWith("/requestApproval") || method === "item/tool/requestUserInput";
  }

  private buildPushPayload(msg: Record<string, unknown>, method: string, threadId: string | null): PushPayload {
    const params = asRecord(msg.params);
    const reason = (params?.reason as string) || "";

    let type = "approval";
    let title = "Approval Required";
    let body = reason || "An action requires your approval";

    if (method === "item/fileChange/requestApproval") {
      title = "File Change Approval";
      body = reason || "A file change needs your approval";
    } else if (method === "item/commandExecution/requestApproval") {
      title = "Command Approval";
      body = reason || "A command needs your approval";
    } else if (method === "item/mcpToolCall/requestApproval") {
      title = "Tool Call Approval";
      body = reason || "A tool call needs your approval";
    } else if (method === "item/tool/requestUserInput") {
      type = "user-input";
      title = "Input Required";
      const questions = (params?.questions as Array<{ question: string }>) || [];
      body = questions[0]?.question || "Input required";
    }

    return {
      type,
      title,
      body,
      threadId: threadId || "",
      actionUrl: threadId ? `/thread/${threadId}` : "/app",
    };
  }

  private async sendPushNotifications(msg: Record<string, unknown>, method: string, threadId: string | null): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    const vapidPublic = this.env.VAPID_PUBLIC_KEY?.trim();
    const vapidPrivate = this.env.VAPID_PRIVATE_KEY?.trim();
    const vapidSubject = this.env.VAPID_SUBJECT?.trim();
    if (!vapidPublic || !vapidPrivate || !vapidSubject) return;

    const vapid: VapidKeys = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject };

    try {
      const { results } = await this.env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
      )
        .bind(this.userId)
        .all<{ endpoint: string; p256dh: string; auth: string }>();

      if (!results.length) return;

      const payload = this.buildPushPayload(msg, method, threadId);

      for (const row of results) {
        try {
          const result = await sendPush(row, payload, vapid);
          if (result.expired) {
            await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
              .bind(row.endpoint)
              .run();
            console.log(`[orbit] push: removed expired subscription`);
          }
        } catch (err) {
          console.warn("[orbit] push: failed to send", err);
        }
      }
    } catch (err) {
      console.warn("[orbit] push: failed to query subscriptions", err);
    }
  }

  private async savePushSubscription(msg: Record<string, unknown>): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    if (typeof msg.endpoint !== "string" || typeof msg.p256dh !== "string" || typeof msg.auth !== "string") return;
    const endpoint = msg.endpoint;
    const p256dh = msg.p256dh;
    const auth = msg.auth;
    if (!endpoint || !p256dh || !auth) return;

    try {
      await this.env.DB.prepare(
        "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth"
      )
        .bind(this.userId, endpoint, p256dh, auth, Math.floor(Date.now() / 1000))
        .run();
      console.log(`[orbit] push: subscription saved for user ${this.userId}`);
    } catch (err) {
      console.warn("[orbit] push: failed to save subscription", err);
    }
  }

  private async removePushSubscription(msg: Record<string, unknown>): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    const endpoint = msg.endpoint as string;
    if (!endpoint) return;

    try {
      await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
        .bind(endpoint, this.userId)
        .run();
      console.log(`[orbit] push: subscription removed for user ${this.userId}`);
    } catch (err) {
      console.warn("[orbit] push: failed to remove subscription", err);
    }
  }

  private async sendTestPush(_socket: WebSocket): Promise<void> {
    if (!this.env.DB || !this.userId) return;

    const vapidPublic = this.env.VAPID_PUBLIC_KEY?.trim();
    const vapidPrivate = this.env.VAPID_PRIVATE_KEY?.trim();
    const vapidSubject = this.env.VAPID_SUBJECT?.trim();
    if (!vapidPublic || !vapidPrivate || !vapidSubject) return;

    const vapid: VapidKeys = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject };

    try {
      const { results } = await this.env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
      )
        .bind(this.userId)
        .all<{ endpoint: string; p256dh: string; auth: string }>();

      if (!results.length) return;

      const payload: PushPayload = {
        type: "test",
        title: "Test Notification",
        body: "Push notifications are working!",
        threadId: "",
        actionUrl: "/app",
      };

      for (const row of results) {
        try {
          const result = await sendPush(row, payload, vapid);
          console.log(`[orbit] push-test: status=${result.status} ok=${result.ok}`);
          if (result.expired) {
            await this.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
              .bind(row.endpoint)
              .run();
          }
        } catch (err) {
          console.warn("[orbit] push-test: failed to send", err);
        }
      }
    } catch (err) {
      console.warn("[orbit] push-test: failed", err);
    }
  }

  private async logEvent(data: unknown, direction: Direction): Promise<void> {
    if (!this.env.DB) return;

    const payloadStr = this.dataToString(data);
    if (!payloadStr) return;

    const message = parseJsonMessage(payloadStr);
    if (!message) return;

    // Skip storage for replayed messages (e.g. re-sent approvals from anchor)
    if (message._replay) return;

    const method = extractMethod(message);
    let threadId = extractThreadId(message);
    let storeMethod = method;

    // Track rpcIds from approval/user-input requests for response matching
    if (method && message.id != null && threadId) {
      if (method.endsWith("/requestApproval") || method === "item/tool/requestUserInput") {
        this.pendingRequestRpcIds.set(message.id as string | number, { threadId, method });
      }
    }

    // Clean up tracked request rpcIds when a turn completes
    if (method === "turn/completed" && threadId) {
      for (const [rpcId, info] of this.pendingRequestRpcIds) {
        if (info.threadId === threadId) this.pendingRequestRpcIds.delete(rpcId);
      }
    }

    // Match client responses (no method, has id + result) to tracked requests
    if (!method && message.id != null && message.result != null) {
      const pending = this.pendingRequestRpcIds.get(message.id as string | number);
      if (pending) {
        this.pendingRequestRpcIds.delete(message.id as string | number);
        threadId = pending.threadId;
        storeMethod = pending.method + "/response";
      }
    }

    if (!threadId) return;
    if (!storeMethod || (!STORED_METHODS.has(storeMethod) && !storeMethod.endsWith("/response"))) return;

    const turnId = extractTurnId(message);
    const entry = {
      ts: new Date().toISOString(),
      direction,
      message,
    };

    try {
      await this.env.DB.prepare(
        "INSERT INTO events (thread_id, user_id, turn_id, direction, role, method, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          threadId,
          this.userId,
          turnId,
          direction,
          direction === "client" ? "client" : "anchor",
          storeMethod,
          JSON.stringify(entry),
          Math.floor(Date.now() / 1000)
        )
        .run();
    } catch (err) {
      console.warn("[orbit] failed to log event", err);
    }
  }
}
