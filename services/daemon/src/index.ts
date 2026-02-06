import { homedir } from "node:os";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

// A simple local daemon to manage the local Zane stack.
// - Exposes /admin/* APIs for status + logs + starting/stopping anchor.
// - Proxies WebSocket endpoints to the local-orbit service.
//
// Note: for now, local-orbit is still a separate process. The daemon manages only Anchor.

const DAEMON_PORT = Number(process.env.ZANE_DAEMON_PORT ?? 8791);
const DAEMON_HOST = process.env.ZANE_DAEMON_HOST ?? "127.0.0.1";

const ANCHOR_CWD = process.env.ZANE_ANCHOR_CWD ?? `${process.cwd()}/../anchor`;
const ANCHOR_CMD = process.env.ZANE_ANCHOR_CMD?.trim() || "bun";
const ANCHOR_ARGS = (process.env.ZANE_ANCHOR_ARGS?.trim() || "run src/index.ts").split(/\s+/);

const STATE_DIR = process.env.ZANE_STATE_DIR ?? `${homedir()}/.zane-local`;
const ANCHOR_LOG = process.env.ZANE_ANCHOR_LOG ?? `${STATE_DIR}/anchor.log`;

mkdirSync(STATE_DIR, { recursive: true });

let anchorProc: Bun.Subprocess | null = null;

function okJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function tailFile(path: string, maxBytes = 64 * 1024): string {
  try {
    const st = statSync(path);
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const fd = Bun.file(path);
    // Bun.file().slice() exists but easiest is read all for now given limit.
    const text = readFileSync(path, "utf8");
    if (text.length <= maxBytes) return text;
    return text.slice(text.length - maxBytes);
  } catch {
    return "";
  }
}

function isAnchorRunning(): boolean {
  return Boolean(anchorProc && anchorProc.exitCode === null);
}

function startAnchor(env: Record<string, string>): { ok: boolean; error?: string } {
  if (isAnchorRunning()) return { ok: true };

  try {
    mkdirSync(dirname(ANCHOR_LOG), { recursive: true });
    const out = Bun.file(ANCHOR_LOG);

    anchorProc = Bun.spawn({
      cmd: [ANCHOR_CMD, ...ANCHOR_ARGS],
      cwd: ANCHOR_CWD,
      stdout: out,
      stderr: out,
      stdin: "ignore",
      env: { ...process.env, ...env },
    });

    anchorProc.exited.then(() => {
      // Keep log file; just mark as stopped.
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

const server = Bun.serve({
  hostname: DAEMON_HOST,
  port: DAEMON_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return okJson({ status: "ok" });
    }

    if (url.pathname === "/admin/status" && req.method === "GET") {
      return okJson({
        daemon: { host: DAEMON_HOST, port: DAEMON_PORT },
        stateDir: STATE_DIR,
        anchor: {
          running: isAnchorRunning(),
          cwd: ANCHOR_CWD,
          log: ANCHOR_LOG,
        },
      });
    }

    if (url.pathname === "/admin/anchor/start" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as null | {
        env?: Record<string, string>;
      };
      const env = body?.env ?? {};
      const res = startAnchor(env);
      return okJson(res, { status: res.ok ? 200 : 500 });
    }

    if (url.pathname === "/admin/anchor/stop" && req.method === "POST") {
      const res = stopAnchor();
      return okJson(res, { status: res.ok ? 200 : 500 });
    }

    if (url.pathname === "/admin/logs" && req.method === "GET") {
      const service = url.searchParams.get("service") ?? "anchor";
      if (service !== "anchor") return new Response("Not found", { status: 404 });
      return new Response(tailFile(ANCHOR_LOG), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`[daemon] listening on http://${DAEMON_HOST}:${server.port}`);
