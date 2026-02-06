<script lang="ts">
  import type { UserInputRequest } from "../types";

  interface Props {
    request: UserInputRequest;
    onSubmit: (answers: Record<string, string[]>) => void;
  }

  const { request, onSubmit }: Props = $props();

  let selections = $state<Record<string, string[]>>({});
  const textInputs = $state<Record<string, string>>({});
  let focusedQuestion = $state(0);
  let focusedOption = $state(0);

  const questions = $derived(request.questions);

  const canSubmit = $derived.by(() => {
    if (request.status !== "pending") return false;
    for (const q of questions) {
      if (q.options && q.options.length > 0) {
        if (!selections[q.id] || selections[q.id].length === 0) return false;
      } else {
        if (!textInputs[q.id]?.trim()) return false;
      }
    }
    return true;
  });

  function selectOption(questionId: string, label: string) {
    if (request.status !== "pending") return;
    selections = { ...selections, [questionId]: [label] };
  }

  function handleSubmit() {
    if (!canSubmit) return;
    const answers: Record<string, string[]> = {};
    for (const q of questions) {
      if (q.options && q.options.length > 0) {
        answers[q.id] = selections[q.id] || [];
      } else {
        answers[q.id] = [textInputs[q.id]?.trim() || ""];
      }
    }
    onSubmit(answers);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (request.status !== "pending") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const q = questions[focusedQuestion];
    if (!q?.options?.length) return;

    const key = e.key;
    if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      if (focusedOption < q.options.length - 1) {
        focusedOption++;
      } else if (focusedQuestion < questions.length - 1) {
        focusedQuestion++;
        focusedOption = 0;
      }
    } else if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      if (focusedOption > 0) {
        focusedOption--;
      } else if (focusedQuestion > 0) {
        focusedQuestion--;
        const prevQ = questions[focusedQuestion];
        focusedOption = (prevQ.options?.length ?? 1) - 1;
      }
    } else if (key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (q.options[focusedOption]) {
        selectOption(q.id, q.options[focusedOption].label);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="input-card" class:resolved={request.status !== "pending"}>
  <div class="card-header">
    <span class="header-label">Questions</span>
  </div>

  {#each questions as question, qi}
    <div class="question-section" class:has-border={qi > 0}>
      <div class="question-header">{question.header || question.question}</div>

      {#if question.header && question.question !== question.header}
        <div class="question-text">{question.question}</div>
      {/if}

      {#if question.options && question.options.length > 0}
        <div class="options-list">
          {#each question.options as option, oi}
            {@const isSelected = selections[question.id]?.includes(option.label)}
            {@const isFocused = request.status === "pending" && focusedQuestion === qi && focusedOption === oi}
            <button
              type="button"
              class="option-btn"
              class:focused={isFocused}
              class:chosen={isSelected}
              onclick={() => {
                focusedQuestion = qi;
                focusedOption = oi;
                selectOption(question.id, option.label);
              }}
              disabled={request.status !== "pending"}
            >
              <span class="radio">{isSelected ? "●" : "○"}</span>
              <span class="option-content">
                <span class="option-label">{option.label}</span>
                {#if option.description}
                  <span class="option-desc">{option.description}</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="text-input-wrap">
          <input
            type={question.isSecret ? "password" : "text"}
            class="text-input"
            placeholder="Type your answer..."
            bind:value={textInputs[question.id]}
            disabled={request.status !== "pending"}
          />
        </div>
      {/if}
    </div>
  {/each}

  <div class="card-footer">
    {#if request.status === "pending"}
      <button
        type="button"
        class="submit-btn"
        disabled={!canSubmit}
        onclick={handleSubmit}
      >
        Submit
      </button>
    {:else}
      <span class="status-badge">Answered</span>
    {/if}
  </div>
</div>

<style>
  .input-card {
    margin: var(--space-xs) var(--space-md);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    background: var(--cli-bg-elevated);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow: hidden;
  }

  .input-card.resolved {
    opacity: 0.6;
  }

  .card-header {
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--cli-border);
  }

  .header-label {
    color: var(--cli-prefix-agent);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .question-section {
    padding: var(--space-sm) var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .question-section.has-border {
    border-top: 1px solid var(--cli-border);
  }

  .question-header {
    color: var(--cli-text);
    font-weight: 500;
  }

  .question-text {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: var(--space-xs);
  }

  .option-btn {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition-fast);
    width: 100%;
  }

  .option-btn:hover:not(:disabled) {
    background: var(--cli-bg-hover);
  }

  .option-btn.focused {
    border-color: var(--cli-border);
    background: var(--cli-bg-hover);
  }

  .option-btn.chosen {
    border-color: var(--cli-prefix-agent);
    background: color-mix(in srgb, var(--cli-prefix-agent) 8%, transparent);
  }

  .option-btn:disabled {
    cursor: default;
  }

  .radio {
    color: var(--cli-text-muted);
    flex-shrink: 0;
    line-height: 1.6;
  }

  .option-btn.chosen .radio {
    color: var(--cli-prefix-agent);
  }

  .option-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .option-label {
    color: var(--cli-text);
    white-space: normal;
    word-break: break-word;
  }

  .option-btn.chosen .option-label {
    color: var(--cli-prefix-agent);
  }

  .option-desc {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
    white-space: normal;
    word-break: break-word;
  }

  .text-input-wrap {
    margin-top: var(--space-xs);
  }

  .text-input {
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    background: var(--cli-bg);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    box-sizing: border-box;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--cli-prefix-agent);
  }

  .text-input:disabled {
    opacity: 0.5;
  }

  .card-footer {
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--cli-border);
    display: flex;
    align-items: center;
  }

  .submit-btn {
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

  .submit-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .status-badge {
    color: var(--cli-success);
    font-size: var(--text-xs);
    font-weight: 600;
  }
</style>
