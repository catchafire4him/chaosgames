/**
 * Optional accounts — server-side token verification (Neon Auth / Better Auth).
 *
 * The phone may send a Neon Auth JWT with join_player. We verify it against the
 * project's public JWKS (EdDSA) and, on success, return the account it belongs
 * to so the join flow can LINK the device's player_key to it. Identity stays the
 * player_key everywhere; the account only annotates who owns the device.
 *
 * FAIL CLOSED: any error → null. The caller treats null as "guest", so a bad or
 * expired token can NEVER break the join flow.
 *
 * Env:
 *   NEON_AUTH_URL — the project's Neon Auth base URL (…/neondb/auth). The JWKS
 *   lives at `${NEON_AUTH_URL}/.well-known/jwks.json` and the token issuer is
 *   that URL's origin. Defaults to this project's URL so dev works out of the box.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

const DEFAULT_AUTH_URL =
  "https://ep-steep-rain-ajbos5tl.neonauth.c-3.us-east-2.aws.neon.tech/neondb/auth";

const AUTH_URL = (process.env.NEON_AUTH_URL ?? DEFAULT_AUTH_URL).replace(/\/$/, "");
const ISSUER = new URL(AUTH_URL).origin;

// Cache the remote key set across calls (jose refreshes it internally on kid miss).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${AUTH_URL}/.well-known/jwks.json`));
  return jwks;
}

export interface AuthAccount {
  accountId: string;
  name?: string;
  email?: string;
}

/** Verify a Neon Auth JWT. Returns the account, or null on ANY failure. */
export async function verifyAuthToken(token: string): Promise<AuthAccount | null> {
  if (!token || typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, keySet(), { issuer: ISSUER });
    const accountId = typeof payload.sub === "string" ? payload.sub : null;
    if (!accountId) return null;
    return {
      accountId,
      name: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch (err) {
    console.warn("[auth] token verify failed (treating as guest):", (err as Error).message);
    return null;
  }
}
