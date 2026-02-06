import type { StoredCredential, StoredUser } from "./types";
import { base64UrlEncode } from "./utils";

interface PasskeyUserRow {
  id: string;
  name: string;
  display_name: string;
}

interface PasskeyCredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
}

/**
 * created_at and revoked_at use milliseconds (Date.now()).
 * expires_at and refresh_expires_at use seconds (Unix epoch).
 */
interface AuthSessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  refresh_token: string | null;
  refresh_expires_at: number | null;
}

export function randomUserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

function parseTransports(value: string | null): StoredCredential["transports"] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as StoredCredential["transports"];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function getUserById(env: CloudflareEnv, userId: string): Promise<StoredUser | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, display_name FROM passkey_users WHERE id = ?"
  )
    .bind(userId)
    .first<PasskeyUserRow>();
  if (!row) return null;
  return { id: row.id, name: row.name, displayName: row.display_name };
}

export async function getUserByName(env: CloudflareEnv, name: string): Promise<StoredUser | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, display_name FROM passkey_users WHERE name = ?"
  )
    .bind(name)
    .first<PasskeyUserRow>();
  if (!row) return null;
  return { id: row.id, name: row.name, displayName: row.display_name };
}

export async function createUser(env: CloudflareEnv, name: string, displayName: string): Promise<StoredUser> {
  const user: StoredUser = {
    id: randomUserId(),
    name,
    displayName,
  };

  await env.DB.prepare("INSERT INTO passkey_users (id, name, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(user.id, user.name, user.displayName, Date.now())
    .run();

  return user;
}

export async function hasAnyUsers(env: CloudflareEnv): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM passkey_users LIMIT 1").first();
  return row !== null;
}

export async function listCredentials(env: CloudflareEnv, userId: string): Promise<StoredCredential[]> {
  const result = await env.DB.prepare(
    "SELECT id, user_id, public_key, counter, transports, device_type, backed_up FROM passkey_credentials WHERE user_id = ? ORDER BY created_at ASC"
  )
    .bind(userId)
    .all<PasskeyCredentialRow>();

  return result.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: parseTransports(row.transports),
    deviceType: row.device_type ?? undefined,
    backedUp: Boolean(row.backed_up),
  }));
}

export async function getCredential(env: CloudflareEnv, id: string): Promise<StoredCredential | null> {
  const row = await env.DB.prepare(
    "SELECT id, user_id, public_key, counter, transports, device_type, backed_up FROM passkey_credentials WHERE id = ?"
  )
    .bind(id)
    .first<PasskeyCredentialRow>();

  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: parseTransports(row.transports),
    deviceType: row.device_type ?? undefined,
    backedUp: Boolean(row.backed_up),
  };
}

export async function upsertCredential(env: CloudflareEnv, credential: StoredCredential): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, device_type, backed_up, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter, transports = excluded.transports, device_type = excluded.device_type, backed_up = excluded.backed_up, updated_at = excluded.updated_at"
  )
    .bind(
      credential.id,
      credential.userId,
      credential.publicKey,
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      credential.deviceType ?? null,
      credential.backedUp ? 1 : 0,
      Date.now(),
      Date.now()
    )
    .run();
}

export async function updateCounter(env: CloudflareEnv, id: string, counter: number): Promise<void> {
  await env.DB.prepare("UPDATE passkey_credentials SET counter = ?, updated_at = ? WHERE id = ?")
    .bind(counter, Date.now(), id)
    .run();
}

/**
 * Stores a session record. The refreshTokenHash should be the SHA-256 hash
 * of the raw refresh token (only the hash is persisted).
 */
export async function createSessionRecord(
  env: CloudflareEnv,
  sessionId: string,
  userId: string,
  expiresAt: number,
  refreshTokenHash: string,
  refreshExpiresAt: number
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, created_at, expires_at, revoked_at, refresh_token, refresh_expires_at) VALUES (?, ?, ?, ?, NULL, ?, ?)"
  )
    .bind(sessionId, userId, Date.now(), expiresAt, refreshTokenHash, refreshExpiresAt)
    .run();
}

export async function getSessionRecord(env: CloudflareEnv, sessionId: string): Promise<AuthSessionRow | null> {
  return await env.DB.prepare("SELECT id, user_id, created_at, expires_at, revoked_at, refresh_token, refresh_expires_at FROM auth_sessions WHERE id = ?")
    .bind(sessionId)
    .first<AuthSessionRow>();
}

export async function revokeSession(env: CloudflareEnv, sessionId: string): Promise<void> {
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(Date.now(), sessionId)
    .run();
}

/**
 * Atomically consume a refresh token: find the session, revoke it, and return
 * the old row. The UPDATE ... WHERE ensures only one concurrent caller wins.
 */
export async function consumeRefreshToken(
  env: CloudflareEnv,
  refreshTokenHash: string,
  nowSec: number
): Promise<AuthSessionRow | null> {
  const row = await env.DB.prepare(
    "UPDATE auth_sessions SET revoked_at = ? WHERE refresh_token = ? AND revoked_at IS NULL AND refresh_expires_at > ? RETURNING id, user_id, created_at, expires_at, revoked_at, refresh_token, refresh_expires_at"
  )
    .bind(Date.now(), refreshTokenHash, nowSec)
    .first<AuthSessionRow>();
  return row ?? null;
}
