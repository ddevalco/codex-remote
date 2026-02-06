import { auth } from "./auth.svelte";
import { config } from "./config.svelte";

function getBaseUrl(): string {
  const wsUrl = config.url;
  if (!wsUrl) return "";
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "";
    return url.origin;
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function doFetch(
  method: string,
  baseUrl: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth.token) {
    headers["authorization"] = `Bearer ${auth.token}`;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  return await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new ApiError(0, "No API URL configured");
  }

  let response = await doFetch(method, baseUrl, path, body);

  // On 401, attempt token refresh and retry once
  if (response.status === 401) {
    const refreshed = await auth.tryRefresh();
    if (refreshed) {
      response = await doFetch(method, baseUrl, path, body);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || response.statusText);
  }

  const text = await response.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
