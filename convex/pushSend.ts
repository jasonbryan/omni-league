import {
  encryptNotification,
  vapidHeaders,
  type PushSubscription,
} from '@block65/webcrypto-web-push';
import { v, type ObjectType } from 'convex/values';
import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from './_generated/server';
import { missingPushConfig, readPushConfig, type PushConfig } from './lib/pushConfig';
import { pushMessageValidator, pushPayload } from './lib/pushMessage';
import {
  FAILURES_BEFORE_DELETE,
  SERVER_ERROR_BACKOFF_SECONDS,
  classifyPushStatus,
  retryAfterSeconds,
} from './lib/pushResponse';
import { isAllowedPushEndpoint } from './lib/pushSubscription';

// Fixed by the library: it signs a token for 12 hours.
const TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000;
// Apple asks for no more than one new token an hour, so a token is replaced only this long before it expires.
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 1;
const MAX_REASON_LENGTH = 40;
const STALE_TOKEN_BATCH = 20;
// A cached token the push service refuses would otherwise fail every send to that origin until it expires.
const TOKEN_REJECTIONS: ReadonlySet<string> = new Set(['BadJwtToken', 'ExpiredJwtToken']);

const target = v.union(
  v.object({
    status: v.literal('send'),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    expirationTime: v.optional(v.number()),
  }),
  v.object({ status: v.literal('skip') }),
);

export const prepare = internalMutation({
  args: { subscriptionId: v.id('pushSubscriptions'), userId: v.id('users') },
  returns: target,
  handler: async (ctx, { subscriptionId, userId }) => {
    const row = await ctx.db.get('pushSubscriptions', subscriptionId);
    // push.subscribe gives an endpoint another user's row, so a send scheduled for the old owner must not reach it.
    if (row?.userId !== userId) return { status: 'skip' as const };
    if (row.expirationTime !== undefined && row.expirationTime <= Date.now()) {
      await ctx.db.delete('pushSubscriptions', row._id);
      return { status: 'skip' as const };
    }
    return {
      status: 'send' as const,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      expirationTime: row.expirationTime,
    };
  },
});

export const recordOutcome = internalMutation({
  args: {
    subscriptionId: v.id('pushSubscriptions'),
    outcome: v.union(v.literal('delivered'), v.literal('gone'), v.literal('rejected')),
  },
  returns: v.null(),
  handler: async (ctx, { subscriptionId, outcome }) => {
    const row = await ctx.db.get('pushSubscriptions', subscriptionId);
    if (!row) return null;
    if (outcome === 'delivered') {
      await ctx.db.patch('pushSubscriptions', row._id, {
        lastSuccessAt: Date.now(),
        failureCount: 0,
      });
    } else if (outcome === 'gone' || row.failureCount + 1 >= FAILURES_BEFORE_DELETE) {
      await ctx.db.delete('pushSubscriptions', row._id);
    } else {
      await ctx.db.patch('pushSubscriptions', row._id, { failureCount: row.failureCount + 1 });
    }
    return null;
  },
});

const tokenKey = { origin: v.string(), publicKey: v.string(), subject: v.string() };

export const cachedToken = internalQuery({
  args: tokenKey,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { origin, publicKey, subject }) => {
    const row = await ctx.db
      .query('pushVapidTokens')
      .withIndex('by_origin', (q) => q.eq('origin', origin))
      .first();
    const fresh = row && row.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now();
    return fresh && row.publicKey === publicKey && row.subject === subject
      ? row.authorization
      : null;
  },
});

export const saveToken = internalMutation({
  args: { ...tokenKey, authorization: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { authorization, expiresAt, ...key }) => {
    const replaced = await ctx.db
      .query('pushVapidTokens')
      .withIndex('by_origin', (q) => q.eq('origin', key.origin))
      .take(STALE_TOKEN_BATCH);
    // Origins differ per Windows push host, so tokens for hosts no longer used are dropped as they expire.
    const expired = await ctx.db
      .query('pushVapidTokens')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', Date.now()))
      .take(STALE_TOKEN_BATCH);
    for (const row of [...replaced, ...expired]) {
      if (await ctx.db.get('pushVapidTokens', row._id))
        await ctx.db.delete('pushVapidTokens', row._id);
    }
    await ctx.db.insert('pushVapidTokens', { ...key, authorization, expiresAt });
    return null;
  },
});

export const dropToken = internalMutation({
  args: { origin: v.string() },
  returns: v.null(),
  handler: async (ctx, { origin }) => {
    const rows = await ctx.db
      .query('pushVapidTokens')
      .withIndex('by_origin', (q) => q.eq('origin', origin))
      .take(STALE_TOKEN_BATCH);
    for (const row of rows) await ctx.db.delete('pushVapidTokens', row._id);
    return null;
  },
});

export const expireTestSend = internalMutation({
  args: { id: v.id('pushTestSends') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get('pushTestSends', id)) await ctx.db.delete('pushTestSends', id);
    return null;
  },
});

// Only a short word from the push service is logged: a body could echo the endpoint.
async function reasonOf(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const reason: unknown =
      typeof body === 'object' && body !== null ? Reflect.get(body, 'reason') : null;
    return typeof reason === 'string' &&
      /^[A-Za-z]+$/.test(reason) &&
      reason.length <= MAX_REASON_LENGTH
      ? reason
      : null;
  } catch {
    return null;
  }
}

const deliverArgs = {
  subscriptionId: v.id('pushSubscriptions'),
  userId: v.id('users'),
  message: pushMessageValidator,
  serverErrorRetries: v.optional(v.number()),
  rateLimitRetries: v.optional(v.number()),
};
type DeliverArgs = ObjectType<typeof deliverArgs>;

async function authorizationFor(
  ctx: ActionCtx,
  subscription: PushSubscription,
  vapid: PushConfig['vapid'],
): Promise<string | null> {
  const key = {
    origin: new URL(subscription.endpoint).origin,
    publicKey: vapid.publicKey,
    subject: vapid.subject,
  };
  const cached = await ctx.runQuery(internal.pushSend.cachedToken, key);
  if (cached !== null) return cached;
  let authorization: string;
  try {
    ({
      headers: { authorization },
    } = await vapidHeaders(subscription, vapid));
  } catch (error) {
    // The error text is left out: it could carry key material.
    console.error(
      `VAPID token not signed (${error instanceof Error ? error.name : 'error'}): check VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY and VAPID_SUBJECT`,
    );
    return null;
  }
  await ctx.runMutation(internal.pushSend.saveToken, {
    ...key,
    authorization,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  });
  return authorization;
}

async function retryAfterServerError(ctx: ActionCtx, args: DeliverArgs): Promise<void> {
  const retries = args.serverErrorRetries ?? 0;
  const wait = SERVER_ERROR_BACKOFF_SECONDS[retries];
  if (wait === undefined) return;
  await ctx.scheduler.runAfter(wait * 1000, internal.pushSend.deliver, {
    ...args,
    serverErrorRetries: retries + 1,
  });
}

export const deliver = internalAction({
  args: deliverArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const config = readPushConfig();
    if (!config) {
      console.error(`Web Push is not configured: set ${missingPushConfig().join(', ')}`);
      return null;
    }
    // A fault here is the server's, so it never counts against the device.
    let payload: string;
    try {
      payload = pushPayload(args.message, config.siteUrl);
    } catch (error) {
      console.error(
        `Push payload not built (${error instanceof Error ? error.name : 'error'}): check SITE_URL and the message`,
      );
      return null;
    }
    const row = await ctx.runMutation(internal.pushSend.prepare, {
      subscriptionId: args.subscriptionId,
      userId: args.userId,
    });
    if (row.status === 'skip') return null;

    if (!isAllowedPushEndpoint(row.endpoint)) {
      console.error('Push refused: the endpoint is not an allowed push service');
      return null;
    }
    const host = new URL(row.endpoint).hostname;
    const subscription = {
      endpoint: row.endpoint,
      expirationTime: row.expirationTime ?? null,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };

    const authorization = await authorizationFor(ctx, subscription, config.vapid);
    if (authorization === null) return null;

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await encryptNotification(subscription, new TextEncoder().encode(payload));
    } catch (error) {
      console.error(`Push to ${host} not built: ${error instanceof Error ? error.name : 'error'}`);
      await ctx.runMutation(internal.pushSend.recordOutcome, {
        subscriptionId: args.subscriptionId,
        outcome: 'rejected',
      });
      return null;
    }

    let response: Response;
    try {
      response = await fetch(row.endpoint, {
        method: 'POST',
        // A redirect would leave the allow-list.
        redirect: 'error',
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(args.message.ttlSeconds),
          Urgency: 'normal',
          Topic: args.message.topic,
        },
        body,
      });
    } catch {
      console.error(`Push to ${host} got no response`);
      await retryAfterServerError(ctx, args);
      return null;
    }

    const outcome = classifyPushStatus(response.status);
    if (outcome === 'delivered') {
      await ctx.runMutation(internal.pushSend.recordOutcome, {
        subscriptionId: args.subscriptionId,
        outcome: 'delivered',
      });
    } else if (outcome === 'gone') {
      await ctx.runMutation(internal.pushSend.recordOutcome, {
        subscriptionId: args.subscriptionId,
        outcome: 'gone',
      });
    } else if (outcome === 'tooLarge') {
      console.error(`Push to ${host} refused: payload too large (413)`);
    } else if (outcome === 'rateLimited') {
      console.error(`Push to ${host} rate limited (429)`);
      const retries = args.rateLimitRetries ?? 0;
      if (retries < MAX_RATE_LIMIT_RETRIES) {
        const seconds = retryAfterSeconds(response.headers.get('Retry-After'), Date.now());
        await ctx.scheduler.runAfter(seconds * 1000, internal.pushSend.deliver, {
          ...args,
          rateLimitRetries: retries + 1,
        });
      }
    } else if (outcome === 'serverError') {
      console.error(`Push to ${host} failed (${response.status})`);
      await retryAfterServerError(ctx, args);
    } else {
      const reason = await reasonOf(response);
      console.error(`Push to ${host} rejected (${response.status})${reason ? `: ${reason}` : ''}`);
      if (
        (response.status === 401 || response.status === 403) &&
        reason !== null &&
        TOKEN_REJECTIONS.has(reason)
      ) {
        await ctx.runMutation(internal.pushSend.dropToken, {
          origin: new URL(row.endpoint).origin,
        });
      }
      await ctx.runMutation(internal.pushSend.recordOutcome, {
        subscriptionId: args.subscriptionId,
        outcome: 'rejected',
      });
    }
    return null;
  },
});
