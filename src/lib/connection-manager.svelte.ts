import { auth } from "./auth.svelte";
import { config } from "./config.svelte";
import { socket } from "./socket.svelte";

const STORE_KEY = "__zane_connection_manager__";

class ConnectionManager {
  #paused = false;
  #pendingConnect: ReturnType<typeof setTimeout> | null = null;
  #connectDebounceMs = 300;

  requestConnect(): void {
    this.#paused = false;
    this.#scheduleConnect();
  }

  requestDisconnect(): void {
    this.#paused = true;
    this.#clearPendingConnect();
    socket.disconnect();
  }

  ensureConnectedOnLoad(): void {
    if (typeof window === "undefined") return;
    if (this.#paused) return;
    this.#scheduleConnect();
  }

  #scheduleConnect(): void {
    if (this.#paused || this.#pendingConnect) return;
    this.#pendingConnect = setTimeout(() => {
      this.#pendingConnect = null;
      this.#connectNow();
    }, this.#connectDebounceMs);
  }

  #connectNow(): void {
    if (auth.status !== "signed_in" || !auth.token) return;
    if (socket.status === "connected" || socket.status === "connecting" || socket.status === "reconnecting") {
      return;
    }
    socket.connect(config.url, auth.token);
  }

  #clearPendingConnect(): void {
    if (this.#pendingConnect) {
      clearTimeout(this.#pendingConnect);
      this.#pendingConnect = null;
    }
  }
}

function getManager(): ConnectionManager {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new ConnectionManager();
  }
  return global[STORE_KEY] as ConnectionManager;
}

export const connectionManager = getManager();
