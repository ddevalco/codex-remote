<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import type { Message } from "../types";

  interface Props {
    message: Message;
    disabled?: boolean;
    latest?: boolean;
    onApprove: () => void;
  }

  const { message, disabled = false, latest = false, onApprove }: Props = $props();

  // svelte-ignore state_referenced_locally
  let isOpen = $state(latest);

  const status = $derived(message.planStatus ?? "pending");
  const resolved = $derived(!latest || status === "approved");

  const planText = $derived(message.text.replace(/<\/?proposed_plan>/g, "").trim());
  const renderedHtml = $derived(DOMPurify.sanitize(marked.parse(planText, { async: false }) as string));

  function handleApprove() {
    if (disabled) return;
    onApprove();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (status !== "pending" || disabled) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (document.querySelector('.input-card:not(.resolved)')) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleApprove();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="plan-card" class:resolved>
  <button class="card-header" type="button" onclick={() => isOpen = !isOpen}>
    <span class="header-left row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <path d="M9 14h6"/>
        <path d="M9 18h6"/>
      </svg>
      <span class="header-label">Proposed Plan</span>
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
    <div class="card-body">
      <div class="plan-text">{@html renderedHtml}</div>
    </div>
  {/if}

  <div class="card-footer">
    {#if !latest}
      <span class="status-badge muted">Plan</span>
    {:else if status === "pending"}
      <button
        type="button"
        class="approve-btn"
        {disabled}
        onclick={handleApprove}
      >
        Approve
      </button>
      <span class="footer-hint">or reply with changes</span>
    {:else}
      <span class="status-badge">Approved</span>
    {/if}
  </div>
</div>

<style>
  .plan-card {
    margin: var(--space-xs) var(--space-md);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    background: var(--cli-bg-elevated);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow: hidden;
  }

  .plan-card.resolved {
    opacity: 0.6;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-bottom: 1px solid var(--cli-border);
    background: transparent;
    color: var(--cli-text);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .card-header:hover {
    background: var(--cli-bg-hover);
  }

  .header-left {
    --row-gap: var(--space-sm);
  }

  .header-left svg {
    width: 1rem;
    height: 1rem;
    color: var(--cli-prefix-agent);
    flex-shrink: 0;
  }

  .header-label {
    color: var(--cli-prefix-agent);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chevron {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    color: var(--cli-text-dim);
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .card-body {
    max-height: 400px;
    overflow-y: auto;
    border-bottom: 1px solid var(--cli-border);
  }

  .plan-text {
    padding: var(--space-sm) var(--space-md);
    color: var(--cli-text);
    font-size: var(--text-xs);
    line-height: 1.6;
    word-break: break-word;
  }

  .plan-text :global(h1),
  .plan-text :global(h2),
  .plan-text :global(h3),
  .plan-text :global(h4) {
    margin: 0.75em 0 0.25em;
    color: var(--cli-text);
    font-weight: 600;
    line-height: 1.4;
  }

  .plan-text :global(h1) { font-size: var(--text-base); }
  .plan-text :global(h2) { font-size: var(--text-sm); }
  .plan-text :global(h3),
  .plan-text :global(h4) { font-size: var(--text-xs); }

  .plan-text :global(p) {
    margin: 0.4em 0;
  }

  .plan-text :global(ul),
  .plan-text :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.5em;
  }

  .plan-text :global(li) {
    margin: 0.2em 0;
  }

  .plan-text :global(code) {
    padding: 0.1em 0.3em;
    background: var(--cli-bg);
    border-radius: var(--radius-sm);
    font-size: 0.9em;
  }

  .plan-text :global(pre) {
    margin: 0.4em 0;
    padding: var(--space-xs) var(--space-sm);
    background: var(--cli-bg);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }

  .plan-text :global(pre code) {
    padding: 0;
    background: transparent;
  }

  .plan-text :global(strong) {
    color: var(--cli-text);
    font-weight: 600;
  }

  .plan-text :global(:first-child) {
    margin-top: 0;
  }

  .plan-text :global(:last-child) {
    margin-bottom: 0;
  }

  .card-footer {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
  }

  .approve-btn {
    padding: var(--space-xs) var(--space-md);
    background: var(--cli-prefix-agent);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-bg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }

  .approve-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .approve-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .footer-hint {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }

  .status-badge {
    color: var(--cli-success);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .status-badge.muted {
    color: var(--cli-text-muted);
  }
</style>
