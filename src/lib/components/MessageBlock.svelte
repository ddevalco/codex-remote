<script lang="ts">
  import type { Message } from "../types";
  import ShimmerDot from "./ShimmerDot.svelte";
  import Reasoning from "./Reasoning.svelte";
  import Tool from "./Tool.svelte";

  interface Props {
    message: Message;
  }

  const { message }: Props = $props();

  const isReasoning = $derived(message.role === "assistant" && message.kind === "reasoning");
  const isTool = $derived(
    message.role === "tool" &&
    message.kind !== "terminal" &&
    message.kind !== "wait" &&
    message.kind !== "compaction"
  );
  const isTerminal = $derived(message.role === "tool" && message.kind === "terminal");
  const isWait = $derived(message.role === "tool" && message.kind === "wait");
  const isCompaction = $derived(message.role === "tool" && message.kind === "compaction");

  const prefixConfig = $derived.by(() => {
    if (message.role === "user") {
      return { prefix: ">", color: "var(--cli-prefix-agent)", bgClass: "user-bg" };
    }
    if (message.role === "assistant") {
      return { prefix: "•", color: "var(--cli-prefix-agent)", bgClass: "" };
    }
    if (message.role === "tool") {
      return { prefix: "•", color: "var(--cli-prefix-tool)", bgClass: "" };
    }
    return { prefix: "•", color: "var(--cli-text-dim)", bgClass: "" };
  });

  const terminalLines = $derived.by(() => {
    if (!isTerminal) return [];
    const lines = message.text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  });
</script>

<div class="message-block {prefixConfig.bgClass}">
  {#if isReasoning}
    <Reasoning
      content={message.text}
      defaultOpen={false}
    />
  {:else if isTool}
    <Tool {message} />
  {:else if isWait}
    <div class="message-line wait row">
      <span class="prefix" style:color={prefixConfig.color}>{prefixConfig.prefix}</span>
      <div class="wait-line row">
        <ShimmerDot color="var(--cli-prefix-tool)" />
        <span class="text dim">{message.text}</span>
      </div>
    </div>
  {:else if isCompaction}
    <div class="message-line compaction row">
      <span class="compaction-icon">↕</span>
      <span class="text dim">Context compacted</span>
    </div>
  {:else if isTerminal}
    <div class="message-line terminal row">
      <span class="prefix" style:color={prefixConfig.color}>{prefixConfig.prefix}</span>
      <div class="terminal-lines stack">
        {#each terminalLines as line}
          <div class="terminal-line row">
            <span class="text">{line}</span>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="message-line row">
      <span class="prefix" style:color={prefixConfig.color}>{prefixConfig.prefix}</span>
      <span class="text">{message.text}</span>
    </div>
  {/if}
</div>

<style>
  .message-block {
    padding: var(--space-xs) var(--space-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .message-block.user-bg {
    background: var(--cli-bg-user);
    border-left: 0;
    box-shadow: none;
    padding-left: var(--space-md);
  }


  .message-line {
    --row-gap: var(--space-sm);
    align-items: flex-start;
  }

  .message-line.terminal {
    align-items: flex-start;
  }

  .message-line.wait {
    align-items: center;
  }

  .terminal-lines {
    --stack-gap: 0.1rem;
  }

  .terminal-line {
    --row-gap: var(--space-sm);
  }

  .wait-line {
    --row-gap: var(--space-sm);
  }

  .message-line.compaction {
    --row-gap: var(--space-sm);
    justify-content: center;
  }

  .compaction-icon {
    color: var(--cli-text-muted);
    font-size: var(--text-xs);
  }

  .prefix {
    flex-shrink: 0;
    font-weight: 600;
  }

  .text {
    color: var(--cli-text);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .text.dim {
    color: var(--cli-text-dim);
    font-style: italic;
  }
</style>
