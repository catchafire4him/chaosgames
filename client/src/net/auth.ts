/**
 * Optional accounts — phone-side auth client (Neon Auth / Better Auth).
 *
 * Login is OPTIONAL everywhere. A guest never touches this. When a player does
 * sign in, we hold a Better Auth session and, at join time, hand the server a
 * short-lived JWT (`getAuthToken`) so it can LINK this device's player_key to
 * the account. The device player_key stays the runtime identity.
 *
 * Base URL comes from VITE_NEON_AUTH_URL (…/neondb/auth), with this project's
 * URL as the default so it works without extra config in dev.
 */
import { createAuthClient } from "better-auth/react";

const DEFAULT_AUTH_URL =
  "https://ep-steep-rain-ajbos5tl.neonauth.c-3.us-east-2.aws.neon.tech/neondb/auth";

export const authBaseUrl = (
  (import.meta.env.VITE_NEON_AUTH_URL as string | undefined) ?? DEFAULT_AUTH_URL
).replace(/\/$/, "");

export const authClient = createAuthClient({ baseURL: authBaseUrl });

export const { useSession, signIn, signUp, signOut } = authClient;

/**
 * Fetch a fresh Neon Auth JWT for the current session, or null if not signed in
 * / anything goes wrong. Sent as `authToken` with join_player. Fails soft: a
 * null just means the server treats this player as a guest.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const res: any = await authClient.$fetch("/token");
    const token = res?.data?.token ?? res?.token ?? null;
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}
