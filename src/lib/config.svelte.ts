const STORE_KEY = "__zane_config_store__";
const STORAGE_KEY = "zane_config";
interface SavedConfig {
  url: string;
}

function isLocalMode(): boolean {
  try {
    return (import.meta as any)?.env?.VITE_ZANE_LOCAL === "1";
  } catch {
    return false;
  }
}

function defaultWsUrlFromLocation(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

class ConfigStore {
  #url = $state("");

  constructor() {
    this.#load();
    // In local mode, auto-default the WS URL to the same origin and keep it stable.
    if (isLocalMode() && !this.#url) {
      this.#url = defaultWsUrlFromLocation();
      this.#save();
    }
  }

  get url() {
    return this.#url;
  }
  set url(value: string) {
    this.#url = value;
    this.#save();
  }

  #load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as SavedConfig;
        this.#url = data.url || this.#url;
      }
    } catch {
      // ignore
    }
  }

  #save() {
    try {
      const data: SavedConfig = {
        url: this.#url,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

function getStore(): ConfigStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new ConfigStore();
  }
  return global[STORE_KEY] as ConfigStore;
}

export const config = getStore();
