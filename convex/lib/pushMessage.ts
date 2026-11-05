import { v, type Infer } from 'convex/values';

/** One 4,096-byte record minus the encryption header and padding delimiter (`@block65/webcrypto-web-push`). */
export const MAX_PAYLOAD_BYTES = 3993;

export const pushMessageValidator = v.object({
  title: v.string(),
  body: v.string(),
  path: v.string(),
  /** The Topic header: a repeat after a retry collapses into one notification. At most 32 URL-safe characters (RFC 8030). */
  topic: v.string(),
  ttlSeconds: v.number(),
});

export type PushMessage = Infer<typeof pushMessageValidator>;

const DAY_SECONDS = 24 * 60 * 60;

export const TEST_MESSAGE: PushMessage = {
  title: 'Omni League',
  body: 'This is a test notification. Notifications work on this device.',
  path: '/app/notifications',
  topic: 'test-notification',
  ttlSeconds: DAY_SECONDS,
};

function siteOrigin(siteUrl: string): URL {
  const url = new URL(siteUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The site URL is not an http(s) URL');
  }
  return url;
}

/** One JSON for Angular's worker and for Safari's Declarative Web Push. */
export function pushPayload(message: PushMessage, siteUrl: string): string {
  const origin = siteOrigin(siteUrl).origin;
  const navigate = new URL(message.path, origin);
  if (!message.path.startsWith('/') || navigate.origin !== origin) {
    throw new Error('A notification path is a path on the site');
  }
  const payload = JSON.stringify({
    web_push: 8030,
    notification: {
      title: message.title,
      body: message.body,
      navigate: navigate.href,
      data: {
        onActionClick: {
          default: { operation: 'navigateLastFocusedOrOpen', url: message.path },
        },
      },
    },
  });
  if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(`The notification payload is too large (limit ${MAX_PAYLOAD_BYTES} bytes)`);
  }
  return payload;
}
