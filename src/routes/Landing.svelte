<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { theme } from "../lib/theme.svelte";
  import { pwa } from "../lib/pwa.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  let showAuthModal = $state(false);
  let authMode = $state<"login" | "register">("login");
  let username = $state("");
  let newUsername = $state("");

  const needsSetup = $derived(auth.status === "needs_setup");
  const isSignedIn = $derived(auth.status === "signed_in");

  $effect(() => {
    if (needsSetup) {
      authMode = "register";
      showAuthModal = true;
    }
  });

  function openModal(mode: "login" | "register") {
    authMode = mode;
    auth.error = null;
    showAuthModal = true;
  }

  function closeModal() {
    showAuthModal = false;
  }
</script>

<svelte:head>
  <title>Zane</title>
</svelte:head>

<div class="landing stack">
  <header class="landing-header">
    <div class="brand">zane</div>
    <div class="header-actions">
      {#if pwa.canInstall && !pwa.isStandalone}
        <button class="ghost-btn" type="button" onclick={() => pwa.install()}>Install app</button>
      {/if}
      {#if isSignedIn}
        <a class="primary-btn" href="/app">Go to app</a>
      {/if}
      <button type="button" class="icon-btn" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        <span class="icon-glyph">{themeIcons[theme.current]}</span>
      </button>
    </div>
  </header>

  <main class="hero stack">
    <div class="hero-copy stack">
      <h1>Remote control for your local Codex.</h1>
      <p>
        Zane lets you start and supervise Codex CLI sessions running on your Mac from a handheld web client.
      </p>
      {#if !isSignedIn}
        <div class="hero-actions row">
          <button class="primary-btn" type="button" onclick={() => openModal("login")}>Sign in</button>
          <button class="ghost-btn" type="button" onclick={() => openModal("register")}>Create account</button>
        </div>
      {/if}
    </div>
  </main>

  <section class="features">
    <div class="feature">
      <span class="feature-label">Anchor</span>
      <p>A lightweight daemon on your Mac that spawns and manages Codex CLI sessions. Your code never leaves the machine.</p>
    </div>
    <div class="feature">
      <span class="feature-label">Orbit</span>
      <p>A Cloudflare relay that connects your devices to Anchor over a secure tunnel. No port-forwarding, no VPN.</p>
    </div>
    <div class="feature">
      <span class="feature-label">Handheld</span>
      <p>Approve file writes, review diffs, and steer tasks from your phone or any browser — wherever you are.</p>
    </div>
  </section>

  <footer class="landing-footer">
    <a class="footer-link" href="https://github.com/z-siddiqi/zane" target="_blank" rel="noopener">GitHub</a>
  </footer>

  {#if showAuthModal}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="modal-overlay" role="presentation" onclick={closeModal}></div>
    <div class="auth-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span>{authMode === "login" ? "Sign in" : "Create account"}</span>
        <button class="modal-close" type="button" onclick={closeModal}>×</button>
      </div>
      <div class="modal-body stack">
        {#if auth.error}
          <div class="auth-error">{auth.error}</div>
        {/if}

        {#if authMode === "login"}
          <input
            type="text"
            class="auth-input"
            placeholder="Username"
            bind:value={username}
            onkeydown={(e) => {
              if (e.key === "Enter" && username.trim()) auth.signIn(username.trim());
            }}
          />
          <button
            class="primary-btn"
            type="button"
            onclick={() => auth.signIn(username.trim())}
            disabled={auth.busy || !username.trim()}
          >
            {auth.busy ? "Working..." : "Sign in with passkey"}
          </button>
          <button
            class="link-btn"
            type="button"
            onclick={() => {
              authMode = "register";
              auth.error = null;
            }}
          >
            Create new account
          </button>
        {:else}
          <input
            type="text"
            class="auth-input"
            placeholder="Username"
            bind:value={newUsername}
            onkeydown={(e) => {
              if (e.key === "Enter" && newUsername.trim()) auth.register(newUsername.trim());
            }}
          />
          <button
            class="primary-btn"
            type="button"
            onclick={() => auth.register(newUsername.trim())}
            disabled={auth.busy || !newUsername.trim()}
          >
            {auth.busy ? "Working..." : "Create passkey"}
          </button>
          <button
            class="link-btn"
            type="button"
            onclick={() => {
              authMode = "login";
              auth.error = null;
            }}
          >
            Back to sign in
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .landing {
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    padding: var(--space-lg) var(--space-md);
  }

  .landing-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .brand {
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cli-prefix-agent);
  }

  .icon-btn {
    background: transparent;
    border: 1px solid var(--cli-border);
    color: var(--cli-text);
    border-radius: var(--radius-sm);
    padding: var(--space-xs) var(--space-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .icon-glyph {
    display: block;
    font-size: var(--text-sm);
    line-height: 1;
    font-family: var(--font-mono);
  }

  .hero {
    align-items: center;
    text-align: center;
    padding-top: clamp(2rem, 8vh, 5rem);
  }

  .hero-copy {
    max-width: 720px;
    --stack-gap: var(--space-lg);
  }

  .hero h1 {
    margin: 0;
    font-size: clamp(2rem, 4vw, 3.5rem);
  }

  .hero p {
    margin: 0;
    color: var(--cli-text-dim);
    line-height: 1.6;
  }

  .hero-actions {
    justify-content: center;
    flex-wrap: wrap;
  }

  .primary-btn,
  .ghost-btn {
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: pointer;
  }

  .primary-btn {
    border: 1px solid var(--cli-border);
    background: var(--color-btn-primary-bg, var(--cli-prefix-agent));
    color: var(--color-btn-primary-text, var(--cli-bg));
    text-decoration: none;
  }

  .ghost-btn {
    background: transparent;
    border: 1px solid var(--cli-border);
    color: var(--cli-text-dim);
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(5, 7, 10, 0.6);
    z-index: 40;
  }

  .auth-modal {
    position: fixed;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(420px, calc(100vw - 2rem));
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    z-index: 50;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--cli-border);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--cli-text-muted);
  }

  .modal-close {
    background: transparent;
    border: none;
    color: var(--cli-text-muted);
    font-size: var(--text-lg);
    cursor: pointer;
  }

  .modal-body {
    padding: var(--space-md);
    --stack-gap: var(--space-md);
  }

  .auth-input {
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    border: 1px solid var(--cli-border);
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    outline: none;
  }

  .auth-error {
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    background: var(--cli-error-bg);
    color: var(--cli-error);
    font-size: var(--text-sm);
  }

  .link-btn {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    text-decoration: underline;
  }

  .link-btn:hover {
    color: var(--cli-text);
  }

  .primary-btn:hover {
    opacity: 0.9;
  }

  .ghost-btn:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Features */
  .features {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-lg);
    max-width: 720px;
    margin: 0 auto;
    padding-top: clamp(2rem, 6vh, 4rem);
  }

  @media (min-width: 640px) {
    .features {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .feature {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .feature-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--cli-prefix-agent);
    font-weight: 600;
  }

  .feature p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--cli-text-dim);
    line-height: 1.5;
  }

  /* Footer */
  .landing-footer {
    margin-top: auto;
    padding-top: clamp(2rem, 6vh, 4rem);
    padding-bottom: var(--space-lg);
    text-align: center;
  }

  .footer-link {
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
    text-decoration: none;
    letter-spacing: 0.04em;
  }

  .footer-link:hover {
    color: var(--cli-text-dim);
  }

</style>
