<script lang="ts">
  import { notifications } from "../notifications.svelte";

  const isIos =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as Record<string, unknown>).standalone === true));
</script>

<div class="section stack">
  <div class="section-header">
    <span class="section-title">Notifications</span>
  </div>
  <div class="section-body stack">
    {#if isIos && !isStandalone}
      <p class="hint">
        To receive notifications on iOS, add this app to your Home Screen:
        tap the share button, then <strong>Add to Home Screen</strong>.
      </p>
    {/if}

    {#if notifications.pushAvailable}
      <div class="setting-row">
        <span class="setting-label">Push notifications</span>
        {#if notifications.pushSubscribed}
          <div class="btn-group">
            <button type="button" class="setting-btn" onclick={() => notifications.unsubscribePush()}>
              Disable
            </button>
            <button type="button" class="setting-btn" onclick={() => notifications.sendTestPush()}>
              Test
            </button>
          </div>
        {:else}
          <button type="button" class="setting-btn" onclick={() => notifications.subscribePush()}>
            Enable
          </button>
        {/if}
      </div>
    {:else}
      <p class="hint">
        Push notifications are not available{isIos && !isStandalone ? " — install as a Home Screen app first" : ""}.
      </p>
    {/if}
  </div>
</div>

<style>
  .section {
    --stack-gap: 0;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .section-header {
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-bg-elevated);
    border-bottom: 1px solid var(--cli-border);
  }

  .section-title {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--cli-text-dim);
  }

  .section-body {
    --stack-gap: var(--space-md);
    padding: var(--space-md);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .setting-label {
    font-size: var(--text-xs);
    color: var(--cli-text);
  }

  .setting-btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .setting-btn:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .btn-group {
    display: flex;
    gap: var(--space-xs);
  }

  .hint {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
    margin: 0;
  }

  .hint strong {
    color: var(--cli-text-dim);
  }
</style>
