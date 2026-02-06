import type { AuthenticatorTransport } from "@simplewebauthn/types";

export interface StoredUser {
  id: string;
  name: string;
  displayName: string;
}

export interface StoredCredential {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  deviceType?: string;
  backedUp: boolean;
}

export interface SessionPayload {
  sub: string;
  name: string;
  jti: string;
}

export interface ChallengeRecord {
  value: string;
  type: "registration" | "authentication";
  userId?: string;
  pendingUser?: { id: string; name: string; displayName: string };
  expiresAt: number;
}

export interface DeviceCodeRecord {
  deviceCode: string;
  userCode: string;
  status: "pending" | "authorised";
  userId?: string;
  expiresAt: number;
}
