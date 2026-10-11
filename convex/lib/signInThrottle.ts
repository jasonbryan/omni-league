// The per-address sign-in throttle's rules (ADR 0008 "Rate limits and lockout", #63). The state
// lives in `signInFailures` (convex/schema.ts), which only convex/signInThrottle.ts touches.

/** Consecutive failures that carry no wait. */
export const FREE_FAILURES = 5;

/** At this many consecutive failures, password sign-in for the address stays refused. */
export const HARD_LIMIT = 100;

const MINUTE_MS = 60 * 1000;

/** The longest wait between two attempts. */
export const MAX_WAIT_MS = 60 * MINUTE_MS;

/** The longest address kept as the key itself; Better Auth's `z.email()` has no bound of its own. */
const MAX_KEY_LENGTH = 254;

/**
 * How long the address waits after its `failures`-th consecutive failure: nothing for the first
 * FREE_FAILURES, then 1 minute, doubling with each further failure up to MAX_WAIT_MS.
 */
export function waitAfterFailures(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_WAIT_MS, MINUTE_MS * 2 ** (failures - FREE_FAILURES));
}

/** The "N" of "Try again in N minutes": the wait in whole minutes, rounded up, at least 1. */
export function retryMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * The sign-in page's text for a throttled attempt (design/mockups/63-sign-in.html), "1 minute"
 * when N is 1. Shared by the server's 429 body and the page.
 */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = retryMinutes(retryAfterSeconds);
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * The `signInFailures` key of a sign-in `email`: the address lowercased, which is how Better Auth
 * looks the user up, so every spelling of one address shares a row. Nothing else is changed, so
 * the key is exactly the string the sign-in endpoint accepts or refuses. An address past 254
 * characters (no real one is) is replaced by a digest, so a row stays small whatever a caller sends.
 */
export async function throttleKey(email: string): Promise<string> {
  const lower = email.toLowerCase();
  if (lower.length <= MAX_KEY_LENGTH) return lower;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lower));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `sha256:${hex.join('')}`;
}
