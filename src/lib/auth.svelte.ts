import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/types";

const STORE_KEY = "__zane_auth_store__";
const STORAGE_KEY = "zane_auth_token";
const REFRESH_STORAGE_KEY = "zane_refresh_token";
const AUTH_BASE_URL = (import.meta.env.AUTH_URL ?? "").replace(/\/$/, "");
const LOCAL_MODE = import.meta.env.VITE_ZANE_LOCAL === "1";

type AuthStatus = "loading" | "signed_out" | "signed_in" | "needs_setup";

interface AuthUser {
  id: string;
  name: string;
}

interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  hasPasskey: boolean;
  systemHasUsers: boolean;
}

interface AuthVerifyResponse {
  verified: boolean;
  token: string;
  refreshToken?: string;
  user?: AuthUser;
}

interface RefreshResponse {
  token: string;
  refreshToken: string;
  user?: AuthUser;
  error?: string;
}

interface LoginOptionsResponse extends PublicKeyCredentialRequestOptionsJSON {
  error?: string;
}

interface RegisterOptionsResponse extends PublicKeyCredentialCreationOptionsJSON {
  error?: string;
}

function apiUrl(path: string): string {
  return `${AUTH_BASE_URL}${path}`;
}

async function parseResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function base64UrlDecodeToString(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = base64UrlDecodeToString(parts[1]);
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}

class AuthStore {
  status = $state<AuthStatus>("loading");
  hasPasskey = $state(false);
  token = $state<string | null>(null);
  user = $state<AuthUser | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  #refreshToken: string | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.#loadToken();
    void this.initialize();
  }

  async initialize() {
    this.status = "loading";
    this.error = null;

    if (LOCAL_MODE) {
      // Local mode has no Auth service; treat the stored token as the shared bearer token.
      // The existing UI can be reused by entering the token as the "username".
      this.status = this.token ? "signed_in" : "signed_out";
      this.user = this.token ? { id: "local", name: "local" } : null;
      this.hasPasskey = false;
      return;
    }

    try {
      const response = await fetch(apiUrl("/auth/session"), {
        method: "GET",
        headers: this.#authHeaders(),
      });
      const data = await parseResponse<AuthSessionResponse>(response);

      if (!response.ok || !data) {
        this.error = "Auth service unavailable.";
        this.status = "signed_out";
        return;
      }

      this.hasPasskey = data.hasPasskey;

      if (data.authenticated && data.user) {
        this.user = data.user;
        this.status = "signed_in";
        this.#scheduleRefresh();
        return;
      }

      if (this.#refreshToken) {
        const refreshed = await this.tryRefresh();
        if (refreshed) {
          const retryResponse = await fetch(apiUrl("/auth/session"), {
            method: "GET",
            headers: this.#authHeaders(),
          });
          const retryData = await parseResponse<AuthSessionResponse>(retryResponse);
          if (retryResponse.ok && retryData?.authenticated && retryData.user) {
            this.hasPasskey = retryData.hasPasskey;
            this.user = retryData.user;
            this.status = "signed_in";
            this.#scheduleRefresh();
            return;
          }

          this.status = "signed_in";
          this.#scheduleRefresh();
          return;
        }
      }

      this.token = null;
      this.#clearToken();
      this.status = data.systemHasUsers ? "signed_out" : "needs_setup";
    } catch {
      this.error = "Auth service unavailable.";
      this.status = "signed_out";
    }
  }

  async signIn(username: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;

    if (LOCAL_MODE) {
      const token = username.trim();
      if (!token) {
        this.error = "Token is required.";
        this.busy = false;
        return;
      }
      this.#applySession({ verified: true, token, refreshToken: undefined, user: { id: "local", name: "local" } });
      this.hasPasskey = false;
      this.busy = false;
      return;
    }

    try {
      const optionsResponse = await fetch(apiUrl("/auth/login/options"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const options = await parseResponse<LoginOptionsResponse>(optionsResponse);
      if (!optionsResponse.ok || !options || options.error) {
        this.error = options?.error ?? "Unable to request sign-in.";
        return;
      }

      const credential = await startAuthentication({ optionsJSON: options });
      const verifyResponse = await fetch(apiUrl("/auth/login/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const verify = await parseResponse<AuthVerifyResponse & { error?: string }>(verifyResponse);
      if (!verifyResponse.ok || !verify?.token) {
        this.error = verify?.error ?? "Sign-in failed.";
        return;
      }

      this.#applySession(verify);
      this.hasPasskey = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Sign-in cancelled.";
    } finally {
      this.busy = false;
    }
  }

  async register(name: string, displayName?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;

    if (LOCAL_MODE) {
      // No registration in local mode.
      this.error = "Registration is disabled in local mode. Use an access token.";
      this.busy = false;
      return;
    }

    try {
      const optionsResponse = await fetch(apiUrl("/auth/register/options"), {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#authHeaders() },
        body: JSON.stringify({ name, displayName: displayName || name }),
      });
      const options = await parseResponse<RegisterOptionsResponse>(optionsResponse);
      if (!optionsResponse.ok || !options || options.error) {
        this.error = options?.error ?? "Unable to start registration.";
        return;
      }

      const credential = await startRegistration({ optionsJSON: options });
      const verifyResponse = await fetch(apiUrl("/auth/register/verify"), {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#authHeaders() },
        body: JSON.stringify({ credential }),
      });
      const verify = await parseResponse<AuthVerifyResponse & { error?: string }>(verifyResponse);
      if (!verifyResponse.ok || !verify?.token) {
        this.error = verify?.error ?? "Registration failed.";
        return;
      }

      this.#applySession(verify);
      this.hasPasskey = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Registration cancelled.";
    } finally {
      this.busy = false;
    }
  }

  async signOut(): Promise<void> {
    if (LOCAL_MODE) {
      this.token = null;
      this.user = null;
      this.status = "signed_out";
      this.error = null;
      this.#clearToken();
      return;
    }

    try {
      if (this.token) {
        await fetch(apiUrl("/auth/logout"), {
          method: "POST",
          headers: this.#authHeaders(),
        });
      }
    } catch {
      // ignore
    }
    this.token = null;
    this.user = null;
    this.status = "signed_out";
    this.error = null;
    this.#clearToken();
  }

  #applySession(payload: AuthVerifyResponse): void {
    this.token = payload.token;
    this.#refreshToken = payload.refreshToken ?? null;
    this.user = payload.user ?? null;
    this.status = "signed_in";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, payload.token);
      if (payload.refreshToken) {
        localStorage.setItem(REFRESH_STORAGE_KEY, payload.refreshToken);
      } else {
        localStorage.removeItem(REFRESH_STORAGE_KEY);
      }
    }
    this.#scheduleRefresh();
  }

  #authHeaders(): HeadersInit {
    if (!this.token) return {};
    return { authorization: `Bearer ${this.token}` };
  }

  #loadToken(): void {
    if (typeof localStorage === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      this.token = stored;
    }
    const storedRefresh = localStorage.getItem(REFRESH_STORAGE_KEY);
    if (storedRefresh) {
      this.#refreshToken = storedRefresh;
    }
  }

  #clearToken(): void {
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    this.#refreshToken = null;
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_STORAGE_KEY);
  }

  #scheduleRefresh(): void {
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    if (!this.token) return;

    // Parse JWT exp to schedule refresh 60s before expiry
    try {
      const payload = decodeJwtPayload(this.token);
      if (!payload?.exp) return;
      const msUntilExpiry = payload.exp * 1000 - Date.now();
      const refreshIn = Math.max(msUntilExpiry - 60_000, 0);
      this.#refreshTimer = setTimeout(() => void this.tryRefresh(), refreshIn);
    } catch {
      // malformed token, skip scheduling
    }
  }

  async tryRefresh(): Promise<boolean> {
    if (this.#refreshPromise) return this.#refreshPromise;
    this.#refreshPromise = this.#doRefresh();
    try {
      return await this.#refreshPromise;
    } finally {
      this.#refreshPromise = null;
    }
  }

  async #doRefresh(): Promise<boolean> {
    if (LOCAL_MODE) return false;
    if (!this.#refreshToken) return false;

    try {
      const response = await fetch(apiUrl("/auth/refresh"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: this.#refreshToken }),
      });
      const data = await parseResponse<RefreshResponse>(response);
      if (!response.ok || !data?.token) {
        // Only sign out on explicit rejection (401). Transient errors (500, 502)
        // should not clear the session — the current JWT may still be valid.
        if (response.status === 401) {
          this.token = null;
          this.user = null;
          this.status = "signed_out";
          this.#clearToken();
        }
        return false;
      }

      this.token = data.token;
      this.#refreshToken = data.refreshToken;
      if (data.user) {
        this.user = data.user;
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, data.token);
        localStorage.setItem(REFRESH_STORAGE_KEY, data.refreshToken);
      }
      this.#scheduleRefresh();
      return true;
    } catch {
      return false;
    }
  }
}

function getStore(): AuthStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new AuthStore();
  }
  return global[STORE_KEY] as AuthStore;
}

export const auth = getStore();
