<script lang="ts">
  interface Props {
    color?: string;
  }

  const { color = "var(--cli-prefix-agent)" }: Props = $props();
</script>

<span class="shimmer-dot" style:--dot-color={color}>●</span>

<style>
  .shimmer-dot {
    display: inline-block;
    color: var(--dot-color);
    animation: shimmer 2s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% {
      opacity: 1;
      filter: brightness(1);
    }
    50% {
      opacity: 0.6;
      filter: brightness(1.5);
    }
  }
</style>
