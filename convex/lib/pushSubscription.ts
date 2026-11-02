// Imports nothing, so the app can use the same rules before it sends a subscription.

/** The browser vendors' push services. Anything else is refused, so a send can never be pointed at an arbitrary URL. */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
] as const;

/** Real endpoints are a few hundred characters; the bound keeps an oversized argument out of an index. */
export const MAX_ENDPOINT_LENGTH = 2048;

/** An uncompressed P-256 public point: 0x04, then 32 bytes each of x and y. */
export const P256DH_BYTES = 65;
export const AUTH_SECRET_BYTES = 16;
const UNCOMPRESSED_POINT_PREFIX = 0x04;

export const MAX_SUBSCRIPTIONS_PER_USER = 10;

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export type PushSubscriptionProblem = 'endpoint' | 'p256dh' | 'auth' | 'expirationTime';

function parsedUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  const url = endpoint.length > MAX_ENDPOINT_LENGTH ? null : parsedUrl(endpoint);
  if (url?.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function unpaddedBase64UrlBytesOrNull(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function isP256PublicKey(text: string): boolean {
  const bytes = unpaddedBase64UrlBytesOrNull(text);
  return bytes?.length === P256DH_BYTES && bytes[0] === UNCOMPRESSED_POINT_PREFIX;
}

export function pushSubscriptionProblem(
  subscription: PushSubscriptionInput,
): PushSubscriptionProblem | null {
  if (!isAllowedPushEndpoint(subscription.endpoint)) return 'endpoint';
  if (!isP256PublicKey(subscription.keys.p256dh)) return 'p256dh';
  if (unpaddedBase64UrlBytesOrNull(subscription.keys.auth)?.length !== AUTH_SECRET_BYTES)
    return 'auth';
  const { expirationTime } = subscription;
  if (expirationTime != null && !(Number.isFinite(expirationTime) && expirationTime > 0)) {
    return 'expirationTime';
  }
  return null;
}
