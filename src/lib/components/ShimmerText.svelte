<script lang="ts">
  interface Props {
    text: string;
    duration?: number;
  }

  const { text, duration = 2 }: Props = $props();
</script>

<span class="shimmer-text" style:--duration="{duration}s">{text}</span>

<style>
  .shimmer-text {
    display: inline-block;
    background: linear-gradient(
      90deg,
      var(--cli-text-dim) 0%,
      var(--cli-text-dim) 40%,
      var(--cli-text) 50%,
      var(--cli-text-dim) 60%,
      var(--cli-text-dim) 100%
    );
    background-size: 200% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer var(--duration) linear infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 100% center;
    }
    100% {
      background-position: -100% center;
    }
  }
</style>
