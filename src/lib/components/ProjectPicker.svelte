<script lang="ts">
  import { socket } from "../socket.svelte";

  interface Props {
    value: string;
    placeholder?: string;
  }

  // eslint-disable-next-line prefer-const -- value is $bindable and reassigned
  let { value = $bindable(""), placeholder = "/path/to/project" }: Props = $props();

  let browsing = $state(false);
  let dirs = $state<string[]>([]);
  let currentPath = $state("");
  let parentPath = $state("");
  let loading = $state(false);
  let browseError = $state<string | null>(null);

  async function browse(path?: string) {
    loading = true;
    browseError = null;
    try {
      const result = await socket.listDirs(path);
      dirs = result.dirs;
      currentPath = result.current;
      parentPath = result.parent;
      browsing = true;
    } catch (err) {
      browseError = err instanceof Error ? err.message : "Failed to list directories";
      dirs = [];
    } finally {
      loading = false;
    }
  }

  function navigateTo(dirName: string) {
    const fullPath = currentPath.endsWith("/")
      ? currentPath + dirName
      : currentPath + "/" + dirName;
    browse(fullPath);
  }

  function navigateUp() {
    if (parentPath && parentPath !== currentPath) {
      browse(parentPath);
    }
  }

  function selectCurrent() {
    value = currentPath;
    browsing = false;
  }

  function selectDir(dirName: string) {
    const fullPath = currentPath.endsWith("/")
      ? currentPath + dirName
      : currentPath + "/" + dirName;
    value = fullPath;
    browsing = false;
  }

  function closeBrowser() {
    browsing = false;
  }
</script>

<div class="project-picker">
  <div class="input-row">
    <input
      type="text"
      bind:value
      {placeholder}
    />
    <button
      type="button"
      class="browse-btn"
      disabled={socket.status !== "connected"}
      onclick={() => browsing ? closeBrowser() : browse(value || undefined)}
      title={browsing ? "Close browser" : "Browse directories"}
    >{browsing ? "×" : "…"}</button>
  </div>

  {#if browsing}
    <div class="dir-browser">
      <div class="dir-header">
        <span class="dir-path" title={currentPath}>{currentPath}</span>
        <button type="button" class="select-btn" onclick={selectCurrent}>Select</button>
      </div>
      {#if loading}
        <div class="dir-loading">Loading...</div>
      {:else if browseError}
        <div class="dir-error">{browseError}</div>
      {:else}
        <ul class="dir-list">
          {#if parentPath && parentPath !== currentPath}
            <li>
              <button type="button" class="dir-item" onclick={navigateUp}>..</button>
            </li>
          {/if}
          {#each dirs as dir}
            <li>
              <button type="button" class="dir-item" onclick={() => navigateTo(dir)} ondblclick={() => selectDir(dir)}>
                {dir}/
              </button>
            </li>
          {/each}
          {#if dirs.length === 0}
            <li class="dir-empty">No subdirectories</li>
          {/if}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .project-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .input-row {
    display: flex;
    gap: var(--space-xs);
  }

  .input-row input {
    flex: 1;
    padding: var(--space-sm);
    background: var(--cli-bg);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text);
    font-family: var(--font-mono);
  }

  .input-row input:focus {
    outline: none;
    border-color: var(--cli-prefix-agent);
  }

  .input-row input::placeholder {
    color: var(--cli-text-muted);
  }

  .browse-btn {
    padding: var(--space-sm) var(--space-sm);
    background: transparent;
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    color: var(--cli-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    min-width: 2.2rem;
  }

  .browse-btn:hover:not(:disabled) {
    color: var(--cli-text);
    border-color: var(--cli-text-muted);
  }

  .browse-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .dir-browser {
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-sm);
    background: var(--cli-bg);
    max-height: 200px;
    display: flex;
    flex-direction: column;
  }

  .dir-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--cli-border);
    gap: var(--space-sm);
  }

  .dir-path {
    font-size: var(--text-xs);
    color: var(--cli-text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .select-btn {
    padding: 2px 8px;
    background: var(--cli-prefix-agent);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cli-bg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }

  .dir-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .dir-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-xs) var(--space-sm);
    background: transparent;
    border: none;
    color: var(--cli-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .dir-item:hover {
    background: var(--cli-selection);
  }

  .dir-loading,
  .dir-error,
  .dir-empty {
    padding: var(--space-sm);
    font-size: var(--text-xs);
    color: var(--cli-text-muted);
  }

  .dir-error {
    color: var(--cli-error);
  }
</style>
