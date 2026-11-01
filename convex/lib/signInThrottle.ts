export const FREE_FAILURES = 5;

export const HARD_LIMIT = 100;

const MINUTE_MS = 60 * 1000;

export const MAX_WAIT_MS = 60 * MINUTE_MS;

// Four free guesses a day stays under the steady 24 a day that a throttled address allows.
export const IDLE_ROW_LIFETIME_MS = 24 * 60 * MINUTE_MS;

// Better Auth's `z.email()` has no length bound, so a longer address is hashed.
const MAX_KEY_LENGTH = 254;

export function waitAfterFailures(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_WAIT_MS, MINUTE_MS * 2 ** (failures - FREE_FAILURES));
}

/**
 * A row below the threshold waits for nothing, so its `blockedUntil` is its last attempt. A row at the
 * threshold or past it never expires, so the hard limit still counts every failure since the last sign-in.
 */
export function idleRowExpiresAt(row: { failures: number; blockedUntil: number }): number | null {
  if (row.failures >= FREE_FAILURES) return null;
  return row.blockedUntil + IDLE_ROW_LIFETIME_MS;
}

export function retryMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = retryMinutes(retryAfterSeconds);
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

export async function throttleKey(email: string): Promise<string> {
  // Better Auth looks the user up lowercased, so every spelling of an address shares a row.
  const lower = email.toLowerCase();
  // No real address is this long; a digest keeps the row small whatever a caller sends.
  if (lower.length <= MAX_KEY_LENGTH) return lower;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lower));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `sha256:${hex.join('')}`;
}
