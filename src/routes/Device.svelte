<script lang="ts">
  import { auth } from "../lib/auth.svelte";

  const AUTH_BASE_URL = (import.meta.env.AUTH_URL ?? "").replace(/\/$/, "");

  let userCode = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);

  async function handleAuthorise(e?: Event) {
    e?.preventDefault();
    if (busy || !userCode.trim()) return;

    busy = true;
    error = null;

    try {
      const response = await fetch(`${AUTH_BASE_URL}/auth/device/authorise`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify({ userCode: userCode.trim() }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        error = data.error ?? "Authorization failed.";
        return;
      }

      success = true;
    } catch {
      error = "Could not reach the auth service.";
    } finally {
      busy = false;
    }
  }

  function formatInput(value: string): string {
    const clean = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
    if (clean.length > 4) {
      return `${clean.slice(0, 4)}-${clean.slice(4)}`;
    }
    return clean;
  }

  function handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    userCode = formatInput(input.value);
    input.value = userCode;
  }
</script>

<div class="device-shell stack">
  <div class="device-card stack">
    {#if auth.status === "loading"}
      <div class="subtitle">Loading...</div>
    {:else if auth.status !== "signed_in"}
      <div class="title">Sign in required</div>
      <div class="subtitle">You must be signed in to authorise a device.</div>
      <a href="/" class="primary-link">Go to sign in</a>
    {:else if success}
      <div class="check">✓</div>
      <div class="title">Device authorised</div>
      <div class="subtitle">Your anchor is now connected. You can close this page.</div>
    {:else}
      <div class="title">Connect anchor</div>
      <div class="subtitle">Enter the code shown in your terminal.</div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <form class="form stack" onsubmit={handleAuthorise}>
        <input
          type="text"
          class="code-input"
          placeholder="XXXX-XXXX"
          value={userCode}
          oninput={handleInput}
          maxlength="9"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          type="submit"
          class="primary"
          disabled={busy || userCode.replace(/-/g, "").length !== 8}
        >
          {busy ? "Authorising..." : "Authorise"}
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .device-shell {
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    align-items: center;
    justify-content: center;
    padding: var(--space-xl) var(--space-md);
    --stack-gap: 0;
  }

  .device-card {
    width: 100%;
    max-width: 400px;
    padding: var(--space-lg);
    --stack-gap: var(--space-md);
    text-align: center;
  }

  .check {
    font-size: 2rem;
    color: var(--cli-success);
  }

  .title {
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .subtitle {
    color: var(--cli-text-dim);
    font-size: var(--text-sm);
  }

  .error {
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    background: var(--cli-error-bg);
    color: var(--cli-error);
    font-size: var(--text-sm);
  }

  .form {
    --stack-gap: var(--space-md);
  }

  .code-input {
    padding: var(--space-md);
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    text-align: center;
    letter-spacing: 0.15em;
    outline: none;
  }

  .code-input:focus {
    border-color: var(--cli-prefix-agent);
  }

  .code-input::placeholder {
    color: var(--cli-text-muted);
    letter-spacing: 0.15em;
  }

  button.primary {
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    border: 1px solid var(--cli-border);
    background: var(--cli-prefix-agent);
    color: var(--cli-bg);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  button.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary-link {
    display: inline-block;
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    border: 1px solid var(--cli-border);
    background: var(--cli-prefix-agent);
    color: var(--cli-bg);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-decoration: none;
    cursor: pointer;
  }
</style>
