<script lang="ts">
  import { untrack } from "svelte";
  import type { Message } from "../types";

  interface Props {
    message: Message;
    defaultOpen?: boolean;
  }

  const { message, defaultOpen = false }: Props = $props();

  let isOpen = $state(untrack(() => defaultOpen));

  function toggle() {
    isOpen = !isOpen;
  }

  // Tool configuration based on kind
  const toolConfig = $derived.by(() => {
    const kind = message.kind;
    switch (kind) {
      case "command":
        return { icon: "terminal", label: "Command", color: "var(--cli-prefix-tool)" };
      case "file":
        return { icon: "file", label: "File Change", color: "var(--cli-prefix-file)" };
      case "mcp":
        return { icon: "plug", label: "MCP Tool", color: "var(--cli-prefix-mcp)" };
      case "web":
        return { icon: "search", label: "Web Search", color: "var(--cli-prefix-web)" };
      case "image":
        return { icon: "image", label: "Image", color: "var(--cli-prefix-image)" };
      case "review":
        return { icon: "eye", label: "Review", color: "var(--cli-prefix-review)" };
      case "plan":
        return { icon: "plan", label: "Plan", color: "var(--cli-prefix-agent)" };
      case "collab":
        return { icon: "users", label: "Agent", color: "var(--cli-prefix-mcp)" };
      default:
        return { icon: "wrench", label: "Tool", color: "var(--cli-prefix-tool)" };
    }
  });

  // Parse tool-specific info
  const toolInfo = $derived.by(() => {
    const kind = message.kind;
    const text = message.text;

    if (kind === "command") {
      const lines = text.split("\n");
      const firstLine = lines[0] || "";
      if (firstLine.startsWith("$ ")) {
        return {
          title: firstLine.slice(2),
          content: lines.slice(1).join("\n"),
          exitCode: message.metadata?.exitCode
        };
      }
      return { title: "Command", content: text, exitCode: message.metadata?.exitCode };
    }

    if (kind === "file") {
      const lines = text.split("\n");
      const filePath = lines[0] || "File";
      return { title: filePath, content: lines.slice(1).join("\n") };
    }

    if (kind === "mcp") {
      const match = text.match(/^Tool:\s*(.+?)(?:\n|$)/);
      const toolName = match?.[1] || "MCP Tool";
      const content = match ? text.slice(match[0].length) : text;
      return { title: toolName, content };
    }

    if (kind === "web") {
      const match = text.match(/^Search:\s*(.+?)(?:\n|$)/);
      return { title: match?.[1] || "Web Search", content: "" };
    }

    if (kind === "image") {
      const match = text.match(/^Image:\s*(.+?)(?:\n|$)/);
      return { title: match?.[1] || "Image", content: "" };
    }

    if (kind === "plan") {
      return { title: "Proposed Plan", content: text };
    }

    if (kind === "collab") {
      const lines = text.split("\n");
      return { title: lines[0] || "Agent", content: lines.slice(1).join("\n") };
    }

    return { title: text.slice(0, 50), content: text };
  });

  // Status based on exit code or content
  const status = $derived.by(() => {
    if (message.kind === "command" && message.metadata?.exitCode !== undefined) {
      return message.metadata.exitCode === 0 ? "success" : "error";
    }
    return "success";
  });

  const statusConfig = $derived.by(() => {
    switch (status) {
      case "success":
        return { icon: "check", label: "Done", color: "var(--cli-success)" };
      case "error":
        return { icon: "x", label: `Exit ${message.metadata?.exitCode}`, color: "var(--cli-error)" };
      default:
        return { icon: "check", label: "Done", color: "var(--cli-success)" };
    }
  });

  const hasContent = $derived(toolInfo.content && toolInfo.content.trim().length > 0);
</script>

<div class="tool" class:open={isOpen}>
  <button class="tool-header row" onclick={toggle} type="button">
    <span class="tool-icon row" style:color={toolConfig.color}>
      {#if toolConfig.icon === "terminal"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" x2="20" y1="19" y2="19"/>
        </svg>
      {:else if toolConfig.icon === "file"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
          <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
          <path d="M10 12h4"/>
          <path d="M10 16h4"/>
        </svg>
      {:else if toolConfig.icon === "plug"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22v-5"/>
          <path d="M9 8V2"/>
          <path d="M15 8V2"/>
          <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>
        </svg>
      {:else if toolConfig.icon === "search"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
      {:else if toolConfig.icon === "image"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
      {:else if toolConfig.icon === "eye"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      {:else if toolConfig.icon === "plan"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
          <path d="M9 14h6"/>
          <path d="M9 18h6"/>
        </svg>
      {:else if toolConfig.icon === "users"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      {/if}
    </span>

    <span class="tool-title">{toolInfo.title}</span>

    <span class="tool-status row" style:color={statusConfig.color}>
      {#if statusConfig.icon === "check"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      {:else if statusConfig.icon === "x"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6 6 18"/>
          <path d="m6 6 12 12"/>
        </svg>
      {/if}
      <span class="status-label">{statusConfig.label}</span>
    </span>

    {#if hasContent}
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
    {/if}
  </button>

  {#if isOpen && hasContent}
    <div class="tool-content">
      <pre class="tool-output">{toolInfo.content}</pre>
    </div>
  {/if}
</div>

<style>
  .tool {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    border: 1px solid var(--cli-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .tool-header {
    --row-gap: var(--space-sm);
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    background: var(--cli-bg-elevated);
    border: none;
    color: var(--cli-text);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: inherit;
    transition: background 0.15s ease;
  }

  .tool-header:hover {
    background: var(--cli-bg-hover);
  }

  .tool-icon {
    --row-gap: 0;
    justify-content: center;
    flex-shrink: 0;
  }

  .tool-icon svg {
    width: 1rem;
    height: 1rem;
  }

  .tool-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--cli-text);
  }

  .tool-status {
    --row-gap: var(--space-xs);
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .tool-status svg {
    width: 0.875rem;
    height: 0.875rem;
  }

  .status-label {
    opacity: 0.9;
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

  .tool-content {
    border-top: 1px solid var(--cli-border);
    background: var(--cli-bg);
    animation: slideIn 0.2s ease;
  }

  .tool-output {
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    color: var(--cli-text-dim);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
