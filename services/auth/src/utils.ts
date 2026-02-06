export function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isAllowedOrigin(origin: string | null, env: CloudflareEnv): boolean {
  if (!origin) return false;
  if (origin === env.PASSKEY_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function corsHeaders(req: Request, env: CloudflareEnv): HeadersInit {
  const origin = req.headers.get("origin");
  const allowedOrigin = isAllowedOrigin(origin, env) ? origin! : "null";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    vary: "origin",
  };
}

export function getRpId(origin: string): string {
  return new URL(origin).hostname;
}
