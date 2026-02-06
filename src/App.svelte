<script lang="ts">
  import { Router } from "sv-router";
  import AuthGate from "./lib/components/AuthGate.svelte";
  import { connectionManager } from "./lib/connection-manager.svelte";
  import { auth } from "./lib/auth.svelte";
  import "./router";

  $effect(() => {
    if (auth.status === "signed_in") {
      connectionManager.ensureConnectedOnLoad();
    }
  });
</script>

<AuthGate>
  <div class="app stack">
    <Router />
  </div>
</AuthGate>

<style>
  .app {
    --stack-gap: 0;
    height: 100%;
    width: 100%;
    max-width: var(--app-max-width);
    margin: 0 auto;
  }
</style>
