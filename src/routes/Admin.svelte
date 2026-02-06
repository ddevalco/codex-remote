<script lang="ts">
  import AppHeader from "../lib/components/AppHeader.svelte";
  import { socket } from "../lib/socket.svelte";
  import { theme } from "../lib/theme.svelte";
  import { auth } from "../lib/auth.svelte";
  import QRCode from "qrcode";

  type Status = {
    daemon: { host: string; port: number };
    stateDir: string;
    anchor: { running: boolean; cwd: string; log: string };
  };

  let status = $state<Status | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let logs = $state<string>("");
  let pair = $state<{ code: string; pairUrl: string; expiresAt: number } | null>(null);
  let pairQrSvg = $state<string>("");

  async function loadStatus() {
    error = null;
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/status", { headers });
      if (res.status === 401) {
        // If the server token changed (reinstall) but the browser still has an old token,
        // force a sign-out so AuthGate shows the access-token prompt again.
        await auth.signOut();
        throw new Error("Unauthorized (token mismatch). Please sign in again with your Access Token.");
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      status = (await res.json()) as Status;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load status";
    }
  }

  async function loadLogs() {
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/logs?service=anchor", { headers });
      logs = res.ok ? await res.text() : "";
    } catch {
      logs = "";
    }
  }

  async function _startAnchor() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/anchor/start", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `start failed (${res.status})`);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to start anchor";
    } finally {
      busy = false;
      await loadStatus();
      await loadLogs();
    }
  }

  async function stopAnchor() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/anchor/stop", { method: "POST", headers });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `stop failed (${res.status})`);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to stop anchor";
    } finally {
      busy = false;
      await loadStatus();
      await loadLogs();
    }
  }

  async function updateQr() {
    if (!pair?.pairUrl) {
      pairQrSvg = "";
      return;
    }
    try {
      pairQrSvg = await QRCode.toString(pair.pairUrl, {
        type: "svg",
        margin: 1,
        width: 260,
        errorCorrectionLevel: "M",
      });
    } catch {
      pairQrSvg = "";
    }
  }

  async function newPair() {
    error = null;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/pair/new", { method: "POST", headers, body: "{}" });
      const data = (await res.json().catch(() => null)) as null | {
        code?: string;
        pairUrl?: string;
        expiresAt?: number;
        error?: string;
      };
      if (!res.ok || !data?.code || !data?.pairUrl || !data?.expiresAt) {
        throw new Error(data?.error || `pair failed (${res.status})`);
      }
      pair = { code: data.code, pairUrl: data.pairUrl, expiresAt: data.expiresAt };
      await updateQr();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to create pairing code";
    }
  }

  $effect(() => {
    loadStatus();
    loadLogs();
    const id = setInterval(() => {
      loadStatus();
    }, 5000);
    return () => clearInterval(id);
  });

  $effect(() => {
    // If the pair changes for any reason, re-render the QR.
    void updateQr();
  });
</script>

<div class="admin stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <a href="/settings">Settings</a>
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {theme.current}
      </button>
    {/snippet}
  </AppHeader>

  <div class="content stack">
    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Admin</span>
      </div>
      <div class="section-body stack">
        {#if error}
          <p class="hint hint-error">{error}</p>
        {/if}

        {#if !status}
          <p class="hint">Loading...</p>
        {:else}
          <div class="kv">
            <div class="k">Daemon</div>
            <div class="v">{status.daemon.host}:{status.daemon.port}</div>

            <div class="k">State dir</div>
            <div class="v"><code>{status.stateDir}</code></div>

            <div class="k">Anchor</div>
            <div class="v">{status.anchor.running ? "running" : "stopped"}</div>

            <div class="k">Anchor cwd</div>
            <div class="v"><code>{status.anchor.cwd}</code></div>

            <div class="k">Anchor log</div>
            <div class="v"><code>{status.anchor.log}</code></div>
          </div>

        <div class="row buttons">
          <button class="danger" type="button" onclick={stopAnchor} disabled={busy || !status.anchor.running}>Stop anchor</button>
          <button type="button" onclick={loadLogs} disabled={busy}>Refresh logs</button>
        </div>
        {/if}
      </div>
    </div>

    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Pair iPhone</span>
      </div>
      <div class="section-body stack">
        <p class="hint">Generate a short-lived pairing code, then scan the QR with your iPhone.</p>
        <div class="row buttons">
          <button class="primary" type="button" onclick={newPair} disabled={!auth.token}>New pairing code</button>
        </div>
        {#if !auth.token}
          <p class="hint hint-error">Sign in first (token required) to create pairing codes.</p>
        {/if}
        {#if pair}
          <div class="kv" style="margin-top: var(--space-md);">
            <div class="k">Code</div>
            <div class="v"><code>{pair.code}</code></div>
            <div class="k">Expires</div>
            <div class="v">{new Date(pair.expiresAt).toLocaleString()}</div>
            <div class="k">Link</div>
            <div class="v"><a href={pair.pairUrl}>{pair.pairUrl}</a></div>
          </div>
          {#if pairQrSvg}
            <div class="qr">{@html pairQrSvg}</div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Anchor logs (tail)</span>
      </div>
      <div class="section-body">
        <pre class="logs">{logs || "(no logs yet)"}</pre>
      </div>
    </div>
  </div>
</div>

<style>
  .admin {
    min-height: 100vh;
  }
  .content {
    padding: var(--space-lg);
    max-width: 1000px;
    margin: 0 auto;
    width: 100%;
  }
  .kv {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: var(--space-sm) var(--space-md);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .k {
    opacity: 0.7;
  }
  .v code {
    word-break: break-all;
  }
  .buttons {
    gap: var(--space-sm);
    flex-wrap: wrap;
    margin-top: var(--space-md);
  }
  .danger {
    background: #5d1b1b;
    border: 1px solid #a33;
    color: #fff;
  }
  .logs {
    max-height: 400px;
    overflow: auto;
    background: rgba(0, 0, 0, 0.35);
    padding: var(--space-md);
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .qr {
    margin-top: var(--space-md);
  }
</style>
