const STORE_KEY = "__zane_theme__";
const STORAGE_KEY = "zane-theme";

export type Theme = "system" | "light" | "dark";

class ThemeStore {
  #theme = $state<Theme>("system");

  constructor() {
    // Load from localStorage on init
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored && ["system", "light", "dark"].includes(stored)) {
        this.#theme = stored;
      }
      this.#applyTheme();
    }
  }

  get current(): Theme {
    return this.#theme;
  }

  set(theme: Theme) {
    this.#theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    this.#applyTheme();
  }

  cycle() {
    const themes: Theme[] = ["system", "light", "dark"];
    const currentIndex = themes.indexOf(this.#theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.set(themes[nextIndex]);
  }

  #applyTheme() {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    if (this.#theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", this.#theme);
    }
  }
}

function getStore(): ThemeStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new ThemeStore();
  }
  return global[STORE_KEY] as ThemeStore;
}

export const theme = getStore();
