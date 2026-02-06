<script lang="ts">
  import { socket } from "../lib/socket.svelte";
  import { threads } from "../lib/threads.svelte";
  import { models } from "../lib/models.svelte";
  import { theme } from "../lib/theme.svelte";
  import AppHeader from "../lib/components/AppHeader.svelte";
  import ProjectPicker from "../lib/components/ProjectPicker.svelte";
  import ShimmerDot from "../lib/components/ShimmerDot.svelte";

  const themeIcons = { system: "◐", light: "○", dark: "●" } as const;

  const permissionPresets = {
    cautious: {
      label: "Cautious",
      detail: "Read-only, always ask",
      approvalPolicy: "on-request",
      sandbox: "read-only",
    },
    standard: {
      label: "Standard",
      detail: "Workspace write, ask",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    },
    autonomous: {
      label: "Autonomous",
      detail: "Full access, no prompts",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    },
  } as const;

  let showTaskModal = $state(false);
  let taskNote = $state("");
  let taskProject = $state("");
  let taskModel = $state("");
  let taskPlanFirst = $state(true);
  let permissionLevel = $state<keyof typeof permissionPresets>("standard");
  let isCreating = $state(false);

  // Default to first available model
  $effect(() => {
    if (!taskModel && models.options.length > 0) {
      taskModel = models.options[0].value;
    }
  });

  function openTaskModal() {
    showTaskModal = true;
  }

  function closeTaskModal() {
    showTaskModal = false;
    taskNote = "";
    taskProject = "";
    taskPlanFirst = true;
    permissionLevel = "standard";
    taskModel = models.options[0]?.value ?? "";
  }

  async function handleCreateTask(e?: Event) {
    e?.preventDefault();
    if (!taskNote.trim() || !taskProject.trim() || isCreating) return;

    isCreating = true;
    try {
      const preset = permissionPresets[permissionLevel];
      threads.start(taskProject, taskNote, {
        approvalPolicy: preset.approvalPolicy,
        sandbox: preset.sandbox,
        suppressNavigation: false,
        collaborationMode: taskPlanFirst
          ? threads.resolveCollaborationMode("plan", taskModel)
          : undefined,
      });

      closeTaskModal();
    } catch (err) {
      console.error("Failed to create task:", err);
    } finally {
      isCreating = false;
    }
  }

  function formatTime(ts?: number): string {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const visibleThreads = $derived(threads.list);

  $effect(() => {
    if (socket.status === "connected") {
      threads.fetch();
      threads.fetchCollaborationPresets();
    }
  });
</script>

<svelte:head>
  <title>Codex Remote</title>
</svelte:head>

<div class="home stack">
  <AppHeader status={socket.status}>
    {#snippet actions()}
      <a href="/settings">Settings</a>
      <a href="/admin">Admin</a>
      <button type="button" onclick={() => theme.cycle()} title="Theme: {theme.current}">
        {themeIcons[theme.current]}
      </button>
    {/snippet}
  </AppHeader>

  {#if socket.error}
    <div class="error row">
      <span class="error-icon">✗</span>
      <span class="error-text">{socket.error}</span>
    </div>
  {/if}

  {#if socket.status === "connected"}
    <div class="threads-section stack">
      <div class="section-header split">
        <div class="section-title-row row">
          <span class="section-title">Threads</span>
          <button class="refresh-btn" onclick={() => threads.fetch()} title="Refresh">↻</button>
        </div>
        <div class="section-actions row">
          <button class="new-task-link" type="button" onclick={openTaskModal}>New task</button>
        </div>
      </div>

      {#if threads.loading}
        <div class="loading row">
          <ShimmerDot /> Loading threads...
        </div>
      {:else if visibleThreads.length === 0}
        <div class="empty row">No threads yet. Create one above.</div>
      {:else}
        <ul class="thread-list">
          {#each visibleThreads as thread (thread.id)}
            <li class="thread-item row">
              <a class="thread-link row" href="/thread/{thread.id}">
                <span class="thread-icon">›</span>
                <span class="thread-preview">{thread.preview || "New thread"}</span>
                <span class="thread-meta">{formatTime(thread.createdAt)}</span>
              </a>
              <button
                class="archive-btn"
                onclick={() => threads.archive(thread.id)}
                title="Archive thread"
              >×</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if showTaskModal}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="modal-overlay" role="presentation" onclick={closeTaskModal}></div>
    <div class="task-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span>New task</span>
        <button class="modal-close" type="button" onclick={closeTaskModal}>×</button>
      </div>
      <form class="modal-body stack" onsubmit={handleCreateTask}>
        <div class="field stack">
          <label for="task-note">task</label>
          <textarea
            id="task-note"
            rows="4"
            bind:value={taskNote}
            placeholder="What do you want to do?"
          ></textarea>
        </div>

        <div class="field stack">
          <label for="task-project">project</label>
          <ProjectPicker bind:value={taskProject} />
        </div>

        <div class="field stack">
          <label for="task-model">model</label>
          <select id="task-model" bind:value={taskModel}>
            {#if models.status === "loading"}
              <option value="">Loading...</option>
            {:else if models.options.length === 0}
              <option value="">No models available</option>
            {:else}
              {#each models.options as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            {/if}
          </select>
        </div>

        <div class="field stack">
          <label for="task-permissions">permissions</label>
          <select id="task-permissions" bind:value={permissionLevel}>
            {#each Object.entries(permissionPresets) as [key, preset]}
              <option value={key}>{preset.label} — {preset.detail}</option>
            {/each}
          </select>
        </div>

        <label class="checkbox-field">
          <input type="checkbox" bind:checked={taskPlanFirst} />
          <span>Plan first</span>
        </label>

        <div class="modal-actions row">
          <button type="button" class="ghost-btn" onclick={closeTaskModal} disabled={isCreating}>Cancel</button>
          <button type="submit" class="primary-btn" disabled={!taskNote.trim() || !taskProject.trim() || isCreating}>
            {isCreating ? "Starting..." : taskPlanFirst ? "Start planning" : "Start task"}
          </button>
        </div>
      </form>
    </div>
  {/if}
</div>

<style>
  .home {
    --stack-gap: 0;
    min-height: 100vh;
    background: var(--cli-bg);
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .field {
    --stack-gap: var(--space-xs);
  }

  .field label {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
  }

  .field select {
    padding: var(--space-sm);
    background: var(--cli-bg);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
  }

  .field select:focus {
    outline: none;
    border-color: var(--cli-prefix-agent);
  }

  .checkbox-field {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--cli-text);
  }

  .checkbox-field input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    accent-color: var(--cli-prefix-agent);
  }

  .error {
    --row-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-error-bg);
    border-bottom: 1px solid var(--cli-border);
    color: var(--cli-error);
  }

  .error-icon {
    font-weight: 600;
  }

  .threads-section {
    flex: 1;
    --stack-gap: 0;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(5, 7, 10, 0.6);
    z-index: 40;
  }

  .task-modal {
    position: fixed;
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 2rem));
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

  .modal-body textarea,
  .modal-body input,
  .modal-body select {
    padding: var(--space-sm);
    background: var(--cli-bg);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
  }

  .modal-body textarea:focus,
  .modal-body input:focus,
  .modal-body select:focus {
    outline: none;
    border-color: var(--cli-prefix-agent);
  }

  .modal-actions {
    justify-content: flex-end;
    gap: var(--space-sm);
  }

  .ghost-btn,
  .primary-btn {
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    text-decoration: none;
  }

  .ghost-btn {
    background: transparent;
    border: 1px solid var(--cli-border);
    color: var(--cli-text-muted);
  }

  .primary-btn {
    background: var(--cli-prefix-agent);
    border: none;
    color: var(--cli-bg);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .section-header {
    --split-gap: var(--space-sm);
    padding: var(--space-sm) 0 var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--cli-border);
  }

  .section-title {
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section-title-row {
    --row-gap: var(--space-xs);
    align-items: center;
  }

  .section-actions {
    --row-gap: var(--space-sm);
    padding-right: var(--space-sm);
  }

  .new-task-link {
    padding: var(--space-sm);
    background: var(--cli-bg);
    appearance: none;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
    text-transform: lowercase;
    transition: all var(--transition-fast);
    cursor: pointer;
  }

  .new-task-link:hover {
    background: var(--cli-selection);
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .refresh-btn {
    padding: var(--space-sm);
    background: transparent;
    border: none;
    color: var(--cli-text-muted);
    font-size: var(--text-base);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .refresh-btn:hover {
    color: var(--cli-text);
  }

  .loading,
  .empty {
    --row-gap: var(--space-sm);
    padding: var(--space-lg) var(--space-md);
    color: var(--cli-text-muted);
  }

  .thread-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow-y: auto;
  }

  .thread-item {
    --row-gap: 0;
    border-bottom: 1px solid var(--cli-border);
  }

  .thread-item:last-child {
    border-bottom: none;
  }

  .thread-link {
    flex: 1;
    min-width: 0;
    --row-gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    text-decoration: none;
    color: inherit;
    transition: background var(--transition-fast);
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }

  .thread-link:hover {
    background: var(--cli-selection);
  }

  .thread-icon {
    color: var(--cli-prefix-agent);
    font-weight: 600;
  }

  .thread-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--cli-text);
  }

  .thread-meta {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
  }

  .archive-btn {
    padding: var(--space-sm) var(--space-md);
    background: transparent;
    border: none;
    color: var(--cli-text-muted);
    font-size: var(--text-base);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .archive-btn:hover {
    color: var(--cli-error);
  }
</style>
