import type { ModelOption, RpcMessage } from "./types";
import { socket } from "./socket.svelte";

type FetchStatus = "idle" | "loading" | "success" | "error";

class ModelsStore {
  options = $state<ModelOption[]>([]);
  status = $state<FetchStatus>("idle");

  #requestId: number | null = null;

  constructor() {
    socket.onMessage((msg) => this.#handleMessage(msg));
    socket.onConnect(() => this.fetch());
  }

  /** Fetch models if we haven't already */
  fetch() {
    if (this.status !== "idle") return;
    this.#send();
  }

  /** Force refresh models */
  refresh() {
    this.status = "idle";
    this.#send();
  }

  #send() {
    if (socket.status !== "connected") return;

    this.#requestId = Date.now();
    this.status = "loading";

    socket.send({
      method: "model/list",
      id: this.#requestId,
      params: {},
    });
  }

  #handleMessage(msg: RpcMessage) {
    // Only handle our request
    if (!this.#requestId || msg.id !== this.#requestId) return;

    this.#requestId = null;

    if (msg.error) {
      this.status = "error";
      console.error("Failed to fetch models:", msg.error);
      return;
    }

    this.options = this.#parseModels(msg.result);
    this.status = this.options.length > 0 ? "success" : "error";
  }

  #parseModels(result: unknown): ModelOption[] {
    // Handle different response shapes
    const items = this.#extractArray(result);

    return items.map((item) => this.#parseModelItem(item)).filter((m): m is ModelOption => m !== null);
  }

  #extractArray(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== "object") return [];

    const obj = result as Record<string, unknown>;
    return (obj.models as unknown[]) ?? (obj.data as unknown[]) ?? (obj.items as unknown[]) ?? [];
  }

  #parseModelItem(item: unknown): ModelOption | null {
    if (typeof item === "string") {
      return { value: item, label: item };
    }

    if (!item || typeof item !== "object") return null;

    const obj = item as Record<string, unknown>;
    const value = String(obj.id ?? obj.model ?? obj.name ?? obj.value ?? "");
    if (!value) return null;

    const label = String(obj.label ?? obj.displayName ?? obj.title ?? value);
    return { value, label };
  }
}

export const models = new ModelsStore();
