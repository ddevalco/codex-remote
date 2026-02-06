import type { ChallengeRecord } from "./types";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function setChallenge(
  env: CloudflareEnv,
  challenge: string,
  opts: {
    type: "registration" | "authentication";
    userId?: string;
    pendingUser?: { id: string; name: string; displayName: string };
  }
): Promise<boolean> {
  const id = env.PASSKEY_CHALLENGE_DO.idFromName("default");
  const stub = env.PASSKEY_CHALLENGE_DO.get(id);
  const record: ChallengeRecord = {
    value: challenge,
    type: opts.type,
    userId: opts.userId,
    pendingUser: opts.pendingUser,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  const response = await stub.fetch("https://challenge/set", {
    method: "POST",
    body: JSON.stringify({ key: challenge, record }),
  });
  return response.ok;
}

export async function consumeChallenge(
  env: CloudflareEnv,
  challenge: string
): Promise<ChallengeRecord | null> {
  const id = env.PASSKEY_CHALLENGE_DO.idFromName("default");
  const stub = env.PASSKEY_CHALLENGE_DO.get(id);
  const response = await stub.fetch("https://challenge/consume", {
    method: "POST",
    body: JSON.stringify({ key: challenge }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { record?: ChallengeRecord };
  return data.record ?? null;
}
