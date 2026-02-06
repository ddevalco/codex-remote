import { buildPushHTTPRequest } from "@pushforge/builder";

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  type: string;
  title: string;
  body: string;
  threadId: string;
  actionUrl: string;
}

export interface VapidKeys {
  publicKey: string; // base64url-encoded raw P-256 public key (65 bytes uncompressed)
  privateKey: string; // base64url-encoded raw P-256 private key (32 bytes)
  subject: string; // "mailto:..." VAPID contact
}

export interface PushResult {
  ok: boolean;
  status: number;
  expired: boolean;
}

function base64urlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// PushForge expects a JWK; we derive it from raw base64url VAPID keys only.
function buildVapidPrivateJwkFromRaw(privateB64: string, publicB64: string) {
  const rawPrivate = base64urlToBytes(privateB64.trim());
  const rawPublic = base64urlToBytes(publicB64.trim());

  if (rawPrivate.length !== 32) {
    throw new Error("Invalid VAPID private key: expected 32-byte base64url string");
  }

  if (rawPublic.length !== 65 || rawPublic[0] !== 4) {
    throw new Error("Invalid VAPID public key: expected 65-byte uncompressed base64url string");
  }

  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64url(rawPublic.slice(1, 33)),
    y: bytesToBase64url(rawPublic.slice(33, 65)),
    d: bytesToBase64url(rawPrivate),
  };
}

export async function sendPush(sub: PushSubscription, payload: PushPayload, vapid: VapidKeys): Promise<PushResult> {
  const privateJwk = buildVapidPrivateJwkFromRaw(vapid.privateKey, vapid.publicKey);
  const subscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };

  const message = {
    payload,
    adminContact: vapid.subject,
    options: { ttl: 3600 },
  };

  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: privateJwk,
    message,
    subscription,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
  });

  // Drain the response body to avoid holding the connection open
  await response.text();

  return {
    ok: response.ok,
    status: response.status,
    expired: response.status === 404 || response.status === 410,
  };
}
