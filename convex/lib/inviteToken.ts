// The bearer token of a staff invite (#67, ADR 0008). It is made only in an action, because Convex
// seeds the randomness of queries and mutations for determinism, which would not suit a secret.
// Nothing but the hash is stored. #70 hashes the token a visitor presents the same way.

/** 32 random bytes: 256 bits. */
export const INVITE_TOKEN_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A new token: 256 random bits from `crypto.getRandomValues`, as base64url (43 characters). */
export function generateInviteToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(INVITE_TOKEN_BYTES)));
}

/** The SHA-256 of the token's text as 64 lower-case hex characters: what `invites.tokenHash` holds. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
