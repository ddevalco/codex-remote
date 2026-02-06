<script lang="ts">
  import type { ModeKind, ModelOption, ReasoningEffort } from "../types";

  interface Props {
    model: string;
    reasoningEffort: ReasoningEffort;
    mode?: ModeKind;
    modelOptions?: ModelOption[];
    modelsLoading?: boolean;
    disabled?: boolean;
    onStop?: () => void;
    onSubmit: (input: string) => void;
    onModelChange: (model: string) => void;
    onReasoningChange: (effort: ReasoningEffort) => void;
    onModeChange?: (mode: ModeKind) => void;
  }

  const {
    model,
    reasoningEffort,
    mode = "code",
    modelOptions = [],
    modelsLoading = false,
    disabled = false,
    onStop,
    onSubmit,
    onModelChange,
    onReasoningChange,
    onModeChange,
  }: Props = $props();

  let input = $state("");
  let modelOpen = $state(false);
  let reasoningOpen = $state(false);

  const canSubmit = $derived(input.trim().length > 0 && !disabled);

  const reasoningOptions: { value: ReasoningEffort; label: string }[] = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  const selectedModel = $derived(
    modelOptions.find((m) => m.value === model)?.label || model || "Model"
  );

  const selectedReasoning = $derived(
    reasoningOptions.find((r) => r.value === reasoningEffort)?.label || "Medium"
  );

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(input.trim());
    input = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function closeAllDropdowns() {
    modelOpen = false;
    reasoningOpen = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".dropdown")) {
      closeAllDropdowns();
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<form class="prompt-input" onsubmit={handleSubmit}>
  <div class="input-container stack">
    <textarea
      bind:value={input}
      onkeydown={handleKeydown}
      placeholder="What would you like to do?"
      rows="1"
      {disabled}
    ></textarea>

    <div class="footer split">
      <div class="tools row">
        <!-- Model Selector -->
        <div class="dropdown" class:open={modelOpen}>
          <button
            type="button"
            class="tool-btn row"
            onclick={(e) => {
              e.stopPropagation();
              modelOpen = !modelOpen;
              reasoningOpen = false;
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z"/>
              <circle cx="12" cy="14" r="2"/>
            </svg>
            <span class="collapsible-label">{selectedModel}</span>
            <svg class="chevron collapsible-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          {#if modelOpen}
            <div class="dropdown-menu">
              {#if modelsLoading}
                <div class="dropdown-empty">Loading...</div>
              {:else if modelOptions.length === 0}
                <div class="dropdown-empty">No models available</div>
              {:else}
                {#each modelOptions as option}
                  <button
                    type="button"
                    class="dropdown-item split"
                    class:selected={model === option.value}
                    onclick={() => {
                      onModelChange(option.value);
                      modelOpen = false;
                    }}
                  >
                    {option.label}
                    {#if model === option.value}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Reasoning Selector -->
        <div class="dropdown" class:open={reasoningOpen}>
          <button
            type="button"
            class="tool-btn row"
            onclick={(e) => {
              e.stopPropagation();
              reasoningOpen = !reasoningOpen;
              modelOpen = false;
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
            <span class="collapsible-label">{selectedReasoning}</span>
            <svg class="chevron collapsible-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          {#if reasoningOpen}
            <div class="dropdown-menu">
              {#each reasoningOptions as option}
                <button
                  type="button"
                  class="dropdown-item split"
                  class:selected={reasoningEffort === option.value}
                  onclick={() => {
                    onReasoningChange(option.value);
                    reasoningOpen = false;
                  }}
                >
                  {option.label}
                  {#if reasoningEffort === option.value}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Mode Toggle -->
        {#if onModeChange}
          <button
            type="button"
            class="tool-btn mode-toggle row"
            class:active={mode === "plan"}
            onclick={() => onModeChange(mode === "plan" ? "code" : "plan")}
          >
            {#if mode === "plan"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
              <span>Plan</span>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
              </svg>
              <span>Code</span>
            {/if}
          </button>
        {/if}
      </div>

      {#if disabled && onStop}
        <button type="button" class="stop-btn row" onclick={onStop} title="Stop">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
        </button>
      {:else}
        <button type="submit" class="submit-btn row" disabled={!canSubmit}>
          {#if disabled}
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m6 17 5-5-5-5"/>
              <path d="m13 17 5-5-5-5"/>
            </svg>
          {/if}
        </button>
      {/if}
    </div>
  </div>
</form>

<style>
  .prompt-input {
    padding: var(--space-md);
  }

  .input-container {
    --stack-gap: 0;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    background: var(--cli-bg);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .input-container:focus-within {
    border-color: var(--cli-text-muted);
    box-shadow: var(--shadow-focus);
  }

  textarea {
    flex: 1;
    padding: var(--space-md);
    font-family: var(--font-mono);
    line-height: 1.6;
    color: var(--cli-text);
    background: transparent;
    border: none;
    resize: none;
    min-height: 4rem;
    max-height: 12rem;
    field-sizing: content;
  }

  textarea:focus {
    outline: none;
  }

  textarea::placeholder {
    color: var(--cli-text-muted);
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .footer {
    --split-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--cli-border);
  }

  .tools {
    --row-gap: var(--space-xs);
  }

  /* Tool buttons */
  .tool-btn {
    --row-gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .tool-btn:hover {
    background: var(--cli-bg-hover);
    color: var(--cli-text);
  }

  .tool-btn svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .tool-btn .chevron {
    width: 0.75rem;
    height: 0.75rem;
    opacity: 0.5;
  }

  .mode-toggle.active {
    background: color-mix(in srgb, var(--cli-prefix-agent) 15%, transparent);
    color: var(--cli-prefix-agent);
  }

  /* Dropdown */
  .dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    min-width: 140px;
    margin-bottom: var(--space-xs);
    padding: var(--space-xs);
    background: var(--cli-bg-elevated);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    z-index: 100;
    animation: fadeIn 0.1s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dropdown-item {
    --split-gap: var(--space-sm);
    width: 100%;
    padding: var(--space-sm) var(--space-sm);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .dropdown-item:hover {
    background: var(--cli-bg-hover);
  }

  .dropdown-item.selected {
    color: var(--cli-prefix-agent);
  }

  .dropdown-empty {
    padding: var(--space-sm);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .dropdown-item svg {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
  }

  /* Submit button */
  .submit-btn {
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--cli-prefix-agent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity var(--transition-fast);
    --row-gap: 0;
  }

  .submit-btn svg {
    width: 1rem;
    height: 1rem;
    color: var(--cli-bg);
  }

  .submit-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .stop-btn {
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--cli-error);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity var(--transition-fast);
    --row-gap: 0;
  }

  .stop-btn svg {
    width: 1rem;
    height: 1rem;
    color: var(--cli-bg);
  }

  .stop-btn:hover {
    opacity: 0.85;
  }

  @media (max-width: 480px) {
    .collapsible-label {
      display: none;
    }
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
