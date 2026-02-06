import { socket } from "./socket.svelte";

const STORE_KEY = "__zane_anchors_store__";
const ANCHOR_CHECK_TIMEOUT_MS = 5_000;

interface AnchorInfo {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
}

type AnchorStatus = "unknown" | "checking" | "connected" | "none";

class AnchorsStore {
  list = $state<AnchorInfo[]>([]);
  status = $state<AnchorStatus>("unknown");
  #checkTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    this.#wire();
  }

  #wire() {
    if (socket.isHealthy) {
      this.request();
    }

    socket.onConnect(() => {
      this.request();
    });

    socket.onProtocol((msg) => {
      if (msg.type === "orbit.anchors") {
        this.list = (msg.anchors as AnchorInfo[]) ?? [];
        this.status = this.list.length ? "connected" : "none";
        this.#clearTimeout();
      } else if (msg.type === "orbit.anchor-connected") {
        const anchor = msg.anchor as AnchorInfo;
        if (!this.list.some((a) => a.id === anchor.id)) {
          this.list = [...this.list, anchor];
        }
        this.status = "connected";
        this.#clearTimeout();
      } else if (msg.type === "orbit.anchor-disconnected") {
        this.list = this.list.filter((a) => a.id !== (msg.anchorId as string));
        this.status = this.list.length ? "connected" : "none";
      }
    });
  }

  request() {
    if (!socket.isHealthy) {
      this.status = "unknown";
      return;
    }
    this.status = "checking";
    this.#armTimeout();
    socket.requestAnchors();
  }

  #armTimeout() {
    this.#clearTimeout();
    this.#checkTimeout = setTimeout(() => {
      if (this.status === "checking" && this.list.length === 0) {
        this.status = "none";
      }
    }, ANCHOR_CHECK_TIMEOUT_MS);
  }

  #clearTimeout() {
    if (this.#checkTimeout) {
      clearTimeout(this.#checkTimeout);
      this.#checkTimeout = null;
    }
  }
}

function getStore(): AnchorsStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new AnchorsStore();
  }
  return global[STORE_KEY] as AnchorsStore;
}

export const anchors = getStore();
