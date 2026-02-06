<script lang="ts">
  import { untrack } from "svelte";
  import ShimmerText from "./ShimmerText.svelte";

  interface Props {
    /** The reasoning text content */
    content: string;
    /** Whether the model is currently streaming reasoning */
    isStreaming?: boolean;
    /** Whether the collapsible starts open */
    defaultOpen?: boolean;
  }

  const {
    content,
    isStreaming = false,
    defaultOpen = true
  }: Props = $props();

  let isOpen = $state(untrack(() => defaultOpen));
  let hasAutoClosed = $state(false);
  let wasStreaming = $state(false);

  const AUTO_CLOSE_DELAY = 1000;

  // Track when streaming ends for auto-close
  $effect(() => {
    if (isStreaming) {
      wasStreaming = true;
    } else if (wasStreaming && isOpen && !hasAutoClosed) {
      const timer = setTimeout(() => {
        isOpen = false;
        hasAutoClosed = true;
      }, AUTO_CLOSE_DELAY);

      return () => clearTimeout(timer);
    }
  });

  function toggle() {
    isOpen = !isOpen;
  }
</script>

<div class="reasoning">
  <button class="reasoning-trigger row" onclick={toggle} type="button">
    <svg class="brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
      <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
      <path d="M6 18a4 4 0 0 1-1.967-.516"/>
      <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
    </svg>
    <span class="trigger-text">
      {#if isStreaming}
        <span class="trigger-text-inline">
          <ShimmerText text="Thinking..." duration={1} />
        </span>
      {:else}
        Thought for a few seconds
      {/if}
    </span>
    <svg
      class="chevron"
      class:open={isOpen}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="m6 9 6 6 6-6"/>
    </svg>
  </button>

  {#if isOpen}
    <div class="reasoning-content">
      <p class="reasoning-text">{content}</p>
    </div>
  {/if}
</div>

<style>
  .reasoning {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .reasoning-trigger {
    --row-gap: var(--space-sm);
    width: 100%;
    padding: var(--space-xs) 0;
    background: none;
    border: none;
    color: var(--cli-text-dim);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: inherit;
    transition: color 0.15s ease;
  }

  .reasoning-trigger:hover {
    color: var(--cli-text);
  }

  .brain-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .trigger-text {
    flex: 1;
    min-width: 0;
  }

  .trigger-text-inline {
    display: inline-block;
  }

  .chevron {
    margin-left: auto;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .reasoning-content {
    margin-top: var(--space-sm);
    padding-left: calc(1rem + var(--space-sm));
    animation: slideIn 0.2s ease;
  }

  .reasoning-text {
    color: var(--cli-text-dim);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
