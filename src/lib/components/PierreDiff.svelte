<script lang="ts">
  import { onDestroy } from "svelte";
  import { FileDiff, parsePatchFiles } from "@pierre/diffs";
  import { theme } from "../theme.svelte";

  interface Props {
    diff: string;
  }

  const { diff }: Props = $props();
  let container: HTMLDivElement | null = $state(null);
  let instances: FileDiff[] = [];

  function cleanup() {
    for (const instance of instances) {
      instance.cleanUp();
    }
    instances = [];
    if (container) {
      container.innerHTML = "";
    }
  }

  function renderFallback() {
    if (!container) return;
    cleanup();
    const fallback = document.createElement("pre");
    fallback.className = "pierre-fallback";
    fallback.textContent = diff;
    container.appendChild(fallback);
  }

  function renderDiff() {
    if (!container || !diff.trim()) return;
    cleanup();

    let patches = [];
    try {
      patches = parsePatchFiles(diff);
    } catch {
      renderFallback();
      return;
    }
    const files = patches.flatMap((patch) => patch.files);
    if (files.length === 0) {
      renderFallback();
      return;
    }

    for (const fileDiff of files) {
      const instance = new FileDiff(
        {
          theme: { light: "pierre-light", dark: "pierre-dark" },
          themeType: theme.current,
          diffStyle: "unified",
          diffIndicators: "classic",
          overflow: "wrap",
          lineDiffType: "word",
          disableFileHeader: true,
        },
        undefined,
        true,
      );
      try {
        instance.render({ fileDiff, containerWrapper: container });
      } catch {
        renderFallback();
        return;
      }
      instances.push(instance);
    }

    if (!container.querySelector("diffs-container")) {
      renderFallback();
    }
  }

  $effect(() => {
    if (!container) return;
    renderDiff();
    return () => cleanup();
  });

  $effect(() => {
    for (const instance of instances) {
      instance.setThemeType(theme.current);
    }
  });

  onDestroy(() => cleanup());
</script>

<div class="pierre-diff stack" bind:this={container}></div>

<style>
  .pierre-diff {
    --stack-gap: var(--space-md);
  }

  :global(.pierre-fallback) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
