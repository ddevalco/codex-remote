<script lang="ts">
  import AppHeader from "../lib/components/AppHeader.svelte";
  import { socket } from "../lib/socket.svelte";
  import { theme } from "../lib/theme.svelte";
  import { auth } from "../lib/auth.svelte";

  type Status = {
    server: { host: string; port: number };
    uiDistDir: string;
    anchor: { running: boolean; cwd: string; host: string; port: number; log: string };
    db: { path: string; retentionDays: number; uploadDir?: string; uploadRetentionDays?: number };
  };

  let status = $state<Status | null>(null);
  let statusError = $state<string | null>(null);
  let pairError = $state<string | null>(null);
  let busy = $state(false);
  let logs = $state<string>("");
  let pair = $state<{ code: string; pairUrl: string; expiresAt: number } | null>(null);
  let pairQrObjectUrl = $state<string>("");
  let autoPairTried = $state(false);
  let debugEvents = $state<string>("");
  let opsLog = $state<string>("");
  let pruningUploads = $state(false);
  let rotatingToken = $state(false);
  let rotatedToken = $state<string | null>(null);
  let uploadRetentionDays = $state<number>(0);
  let savingUploadRetention = $state(false);

  async function loadStatus() {
    statusError = null;
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
      try {
        const rd = (status.db as any)?.uploadRetentionDays;
        if (typeof rd === "number" && Number.isFinite(rd)) {
          uploadRetentionDays = rd;
        }
      } catch {
        // ignore
      }
    } catch (e) {
      statusError = e instanceof Error ? e.message : "Failed to load status";
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

  async function loadDebugEvents() {
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/debug/events?limit=50", { headers });
      if (!res.ok) {
        debugEvents = "";
        return;
      }
      const data = (await res.json()) as { data?: string[] };
      debugEvents = (data.data ?? []).join("\n");
    } catch {
      debugEvents = "";
    }
  }

  async function loadOpsLog() {
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/ops?limit=80", { headers });
      if (!res.ok) {
        opsLog = "";
        return;
      }
      const data = (await res.json()) as { data?: string[] };
      opsLog = (data.data ?? []).join("\n");
    } catch {
      opsLog = "";
    }
  }

  async function pruneUploadsNow() {
    if (pruningUploads) return;
    pruningUploads = true;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      await fetch("/admin/uploads/prune", { method: "POST", headers, body: "{}" });
    } finally {
      pruningUploads = false;
      await loadOpsLog();
    }
  }


  async function rotateToken() {
    if (rotatingToken) return;
    rotatedToken = null;
    rotatingToken = true;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/token/rotate", { method: "POST", headers, body: "{}" });
      const data = (await res.json().catch(() => null)) as null | { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data?.ok || !data.token) {
        throw new Error(data?.error || `rotate failed (${res.status})`);
      }
      rotatedToken = data.token;
      try {
        await navigator.clipboard.writeText(data.token);
      } catch {
        // ignore
      }
      // Force sign-out so the admin UI re-prompts for the new token.
      await auth.signOut();
    } catch (e) {
      statusError = e instanceof Error ? e.message : "Failed to rotate token";
    } finally {
      rotatingToken = false;
      await loadStatus();
    }
  }

  async function saveUploadRetention() {
    if (savingUploadRetention) return;
    savingUploadRetention = true;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/uploads/retention", {
        method: "POST",
        headers,
        body: JSON.stringify({ retentionDays: uploadRetentionDays }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `save failed (${res.status})`);
      }
    } catch (e) {
      statusError = e instanceof Error ? e.message : "Failed to save upload retention";
    } finally {
      savingUploadRetention = false;
      await loadDebugEvents();
      await loadOpsLog();
    }
  }

  async function _startAnchor() {
    if (busy) return;
    busy = true;
    statusError = null;
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
      statusError = e instanceof Error ? e.message : "Failed to start anchor";
    } finally {
      busy = false;
      await loadStatus();
      await loadLogs();
    }
  }

  async function stopAnchor() {
    if (busy) return;
    busy = true;
    statusError = null;
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch("/admin/anchor/stop", { method: "POST", headers });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `stop failed (${res.status})`);
      }
    } catch (e) {
      statusError = e instanceof Error ? e.message : "Failed to stop anchor";
    } finally {
      busy = false;
      await loadStatus();
      await loadLogs();
    }
  }

  async function updateQr() {
    // Security: load QR as an image blob using Authorization header, not by putting the token in a querystring.
    if (!pair?.code) {
      if (pairQrObjectUrl) URL.revokeObjectURL(pairQrObjectUrl);
      pairQrObjectUrl = "";
      return;
    }
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      const res = await fetch(`/admin/pair/qr.svg?code=${encodeURIComponent(pair.code)}`, { headers });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `QR failed (${res.status})`);
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      if (pairQrObjectUrl) URL.revokeObjectURL(pairQrObjectUrl);
      pairQrObjectUrl = nextUrl;
    } catch (e) {
      if (pairQrObjectUrl) URL.revokeObjectURL(pairQrObjectUrl);
      pairQrObjectUrl = "";
      pairError = e instanceof Error ? e.message : "QR generation failed";
    }
  }

  async function newPair() {
    pairError = null;
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
      pairError = e instanceof Error ? e.message : "Failed to create pairing code";
    }
  }

  $effect(() => {
    loadStatus();
    loadLogs();
    loadDebugEvents();
    const id = setInterval(() => {
      loadStatus();
    }, 5000);
    return () => clearInterval(id);
  });

  $effect(() => {
    // If the pair changes for any reason, re-render the QR.
    void updateQr();

    // Cleanup object URL on component teardown.
    return () => {
      if (pairQrObjectUrl) URL.revokeObjectURL(pairQrObjectUrl);
    };
  });

  $effect(() => {
    // First-run UX: auto-generate a pairing code once after auth succeeds so the user immediately sees a QR.
    // We persist a local flag to avoid minting a new code on every page refresh.
    if (autoPairTried) return;
    if (!auth.token) return;
    if (pair) return;
    try {
      // Key includes a small token fingerprint so reinstall/new-token triggers auto-pair again.
      const fp = auth.token.slice(-8);
      const key = `codex-pocket:autoPairDone:${location.origin}:${fp}`;
      if (localStorage.getItem(key) === "1") {
        autoPairTried = true;
        return;
      }
      autoPairTried = true;
      void (async () => {
        await newPair();
        localStorage.setItem(key, "1");
      })();
    } catch {
      // localStorage may be blocked; still try once per load.
      autoPairTried = true;
      void newPair();
    }
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
        {#if statusError}
          <p class="hint hint-error">{statusError}</p>
        {/if}

        {#if !status}
          <p class="hint">Loading...</p>
        {:else}
          <div class="kv">
            <div class="k">Server</div>
            <div class="v">{status.server.host}:{status.server.port}</div>

            <div class="k">UI dist</div>
            <div class="v"><code>{status.uiDistDir}</code></div>

            <div class="k">Anchor</div>
            <div class="v">{status.anchor.running ? "running" : "stopped"}</div>

            <div class="k">Anchor cwd</div>
            <div class="v"><code>{status.anchor.cwd}</code></div>

            <div class="k">Anchor addr</div>
            <div class="v">{status.anchor.host}:{status.anchor.port}</div>

            <div class="k">Anchor log</div>
            <div class="v"><code>{status.anchor.log}</code></div>

            <div class="k">DB</div>
            <div class="v"><code>{status.db.path}</code> (retention {status.db.retentionDays}d)</div>

            <div class="k">Uploads</div>
            <div class="v">{status.db.uploadDir ? `dir: ${status.db.uploadDir}` : "(not configured)"}</div>

            <div class="k">Upload retention</div>
            <div class="v">{(status.db.uploadRetentionDays ?? uploadRetentionDays)} day(s) ({(status.db.uploadRetentionDays ?? uploadRetentionDays) === 0 ? "keep forever" : "auto-clean"})</div>
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
        {#if pairError}
          <p class="hint hint-error">{pairError}</p>
        {/if}
        <div class="row buttons">
          <button class="primary" type="button" onclick={newPair} disabled={!auth.token}>Regenerate pairing code</button>
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
          {#if pairQrObjectUrl}
            <div class="qr"><img alt="Pairing QR code" src={pairQrObjectUrl} /></div>
          {:else}
            <p class="hint hint-error">QR did not render. Open the Link above on your iPhone.</p>
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

    <div class="section stack">
      <div class="section-header">
        <span class="section-title">Uploads</span>
      </div>
      <div class="section-body stack">
        <p class="hint">Uploads are stored locally on your Mac. Default retention is permanent.</p>

        <div class="field stack">
          <label for="upload-retention">upload retention (days)</label>
          <input
            id="upload-retention"
            type="number"
            min="0"
            max="3650"
            bind:value={uploadRetentionDays}
          />
          <p class="hint">0 = keep uploads forever. Cleanup runs periodically on the Mac (and you can run it manually).</p>
          <div class="row buttons">
            <button type="button" onclick={saveUploadRetention} disabled={!auth.token || savingUploadRetention}>
              {savingUploadRetention ? "Saving..." : "Save"}
            </button>
            <button type="button" onclick={pruneUploadsNow} disabled={!auth.token || pruningUploads}>
              {pruningUploads ? "Pruning..." : "Run cleanup now"}
            </button>
          </div>
        </div>

        <p class="hint">Ops log (server maintenance + installer actions).</p>
        <div class="row buttons">
        </div>
        <pre class="logs">{opsLog || "(no ops logs yet)"}</pre>
      </div>
    </div>

<div class="section stack">
      <div class="section-header">
        <span class="section-title">Debug</span>
      </div>
      <div class="section-body stack">
        <p class="hint">Last 50 stored events (redacted). Useful for diagnosing blank threads or protocol mismatches.</p>
        <div class="row buttons">
          <button type="button" onclick={loadDebugEvents} disabled={busy}>Refresh events</button>
          <button type="button" onclick={pruneUploadsNow} disabled={!auth.token || pruningUploads}>
            {pruningUploads ? "Pruning..." : "Run upload cleanup"}
          </button>
          <button class="danger" type="button" onclick={rotateToken} disabled={!auth.token || rotatingToken}>
            {rotatingToken ? "Rotating..." : "Rotate access token"}
          </button>
        </div>
        {#if rotatedToken}
          <p class="hint">New token copied to clipboard. You will need to sign in again on all devices.</p>
          <p><code>{rotatedToken}</code></p>
        {/if}
        <pre class="logs">{debugEvents || "(no events yet)"}</pre>
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
  .qr {
    margin-top: var(--space-md);
    display: flex;
    justify-content: flex-start;
  }
  .qr img {
    width: 260px;
    height: 260px;
    image-rendering: pixelated;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: #fff;
    padding: 6px;
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

  .field input {
    width: 100%;
    padding: var(--space-sm);
    background: var(--cli-bg);
    color: var(--cli-text);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .field input:focus {
    outline: none;
    border-color: var(--cli-text-muted);
    box-shadow: var(--shadow-focus);
  }
  .qr {
    margin-top: var(--space-md);
  }
</style>
