import { navigate } from "../router";

const STORE_KEY = "__zane_pwa_store__";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

class PwaStore {
  #deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
  #isStandalone = $state(false);

  constructor() {
    if (typeof window === "undefined") return;

    this.#isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        (navigator as Record<string, unknown>).standalone === true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "navigate" && event.data?.url) {
          navigate(event.data.url);
        }
      });
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.#deferredPrompt = e as BeforeInstallPromptEvent;
    });

    window.addEventListener("appinstalled", () => {
      this.#deferredPrompt = null;
      this.#isStandalone = true;
    });
  }

  get canInstall(): boolean {
    return this.#deferredPrompt !== null;
  }

  get isStandalone(): boolean {
    return this.#isStandalone;
  }

  async install(): Promise<boolean> {
    if (!this.#deferredPrompt) return false;
    await this.#deferredPrompt.prompt();
    const { outcome } = await this.#deferredPrompt.userChoice;
    this.#deferredPrompt = null;
    return outcome === "accepted";
  }
}

function getStore(): PwaStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new PwaStore();
  }
  return global[STORE_KEY] as PwaStore;
}

export const pwa = getStore();
