<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { navigate } from "../router";

  const LOCAL_MODE = import.meta.env.VITE_ZANE_LOCAL === "1";

  let status = $state<"loading" | "ok" | "error">("loading");
  let error = $state<string | null>(null);

  function getCode(): string | null {
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      return code && code.trim() ? code.trim() : null;
    } catch {
      return null;
    }
  }

  async function run() {
    if (!LOCAL_MODE) {
      status = "error";
      error = "Pairing is only available in local mode.";
      return;
    }

    const code = getCode();
    if (!code) {
      status = "error";
      error = "Missing pairing code.";
      return;
    }

    try {
      const res = await fetch("/pair/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as null | { token?: string; error?: string };
      if (!res.ok || !data?.token) {
        throw new Error(data?.error || `Pairing failed (${res.status})`);
      }

      // In local mode, signIn(username) treats username as the token.
      await auth.signIn(data.token);
      status = "ok";
      navigate("/app");
    } catch (e) {
      status = "error";
      error = e instanceof Error ? e.message : "Pairing failed.";
    }
  }

  $effect(() => {
    run();
  });
</script>

<div class="pair stack">
  {#if status === "loading"}
    <div class="card">Pairing…</div>
  {:else if status === "error"}
    <div class="card error">
      <div class="title">Pairing failed</div>
      <div class="msg">{error}</div>
      <a class="link" href="/">Go back</a>
    </div>
  {:else}
    <div class="card">Paired. Redirecting…</div>
  {/if}
</div>

<style>
  .pair {
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    padding: var(--space-lg);
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
  }
  .card {
    width: 100%;
    max-width: 520px;
    padding: var(--space-lg);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.35);
  }
  .error .title {
    font-weight: 700;
    margin-bottom: var(--space-sm);
  }
  .msg {
    opacity: 0.85;
    word-break: break-word;
  }
  .link {
    display: inline-block;
    margin-top: var(--space-md);
    opacity: 0.9;
  }
</style>

