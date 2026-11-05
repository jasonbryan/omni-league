import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  env,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { requireUser } from './lib/access';
import { TEST_MESSAGE } from './lib/pushMessage';
import {
  isP256PublicKey,
  MAX_ENDPOINT_LENGTH,
  MAX_SUBSCRIPTIONS_PER_USER,
  pushSubscriptionProblem,
} from './lib/pushSubscription';
import { TEST_SEND_LIMIT, TEST_SEND_WINDOW_MS } from './lib/pushTestSend';

export const PUSH_SUBSCRIPTION_INVALID_CODE = 'pushSubscriptionInvalid';

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: the VAPID public key is what every browser subscribes with, and the returns validator allows nothing else.
export const getConfig = query({
  args: {},
  returns: v.object({ vapidPublicKey: v.union(v.string(), v.null()) }),
  handler: () => {
    const key = env.VAPID_PUBLIC_KEY?.trim() ?? '';
    return Promise.resolve({ vapidPublicKey: isP256PublicKey(key) ? key : null });
  },
});

async function rowByEndpoint(
  ctx: Pick<QueryCtx, 'db'>,
  endpoint: string,
): Promise<Doc<'pushSubscriptions'> | null> {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  return ctx.db
    .query('pushSubscriptions')
    .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
    .unique();
}

async function dropLeastRecentlySeenOverCap(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  const rows = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(MAX_SUBSCRIPTIONS_PER_USER * 2);
  const oldestFirst = rows.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
  for (const row of oldestFirst.slice(0, Math.max(0, rows.length - MAX_SUBSCRIPTIONS_PER_USER))) {
    await ctx.db.delete('pushSubscriptions', row._id);
  }
}

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    expirationTime: v.optional(v.union(v.number(), v.null())),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
  },
  returns: v.null(),
  handler: async (ctx, subscription) => {
    const user = await requireUser(ctx);
    const problem = pushSubscriptionProblem(subscription);
    if (problem) throw new ConvexError({ code: PUSH_SUBSCRIPTION_INVALID_CODE, field: problem });

    const now = Date.now();
    const fields = {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expirationTime: subscription.expirationTime ?? undefined,
      lastSeenAt: now,
    };
    const existing = await rowByEndpoint(ctx, subscription.endpoint);
    if (existing?.userId === user._id) {
      await ctx.db.patch('pushSubscriptions', existing._id, fields);
      return null;
    }
    // A row another user saved for this browser starts over as the caller's, with no send history.
    if (existing) await ctx.db.delete('pushSubscriptions', existing._id);
    await ctx.db.insert('pushSubscriptions', {
      ...fields,
      userId: user._id,
      endpoint: subscription.endpoint,
      createdAt: now,
      failureCount: 0,
    });
    await dropLeastRecentlySeenOverCap(ctx, user._id);
    return null;
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const user = await requireUser(ctx);
    const row = await rowByEndpoint(ctx, endpoint);
    if (row?.userId === user._id) await ctx.db.delete('pushSubscriptions', row._id);
    return null;
  },
});

export const getMyDeviceStatus = query({
  args: { endpoint: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { endpoint }) => {
    const user = await requireUser(ctx);
    const row = await rowByEndpoint(ctx, endpoint);
    return row?.userId === user._id;
  },
});

const sendTestResult = v.union(
  v.object({ status: v.literal('sent'), devices: v.number() }),
  v.object({ status: v.literal('noDevice') }),
  v.object({ status: v.literal('rateLimited'), retryAfterSeconds: v.number() }),
);

export const sendTest = mutation({
  args: {},
  returns: sendTestResult,
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const windowStart = now - TEST_SEND_WINDOW_MS;
    const past = await ctx.db
      .query('pushTestSends')
      .withIndex('by_userId_and_sentAt', (q) => q.eq('userId', user._id).lte('sentAt', windowStart))
      .take(TEST_SEND_LIMIT * 2);
    for (const send of past) await ctx.db.delete('pushTestSends', send._id);

    const devices = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .take(MAX_SUBSCRIPTIONS_PER_USER);
    if (devices.length === 0) return { status: 'noDevice' as const };

    const recent = await ctx.db
      .query('pushTestSends')
      .withIndex('by_userId_and_sentAt', (q) => q.eq('userId', user._id).gt('sentAt', windowStart))
      .take(TEST_SEND_LIMIT);
    const oldest = recent[0];
    if (oldest && recent.length >= TEST_SEND_LIMIT) {
      return {
        status: 'rateLimited' as const,
        retryAfterSeconds: Math.ceil((oldest.sentAt + TEST_SEND_WINDOW_MS - now) / 1000),
      };
    }

    const sendId = await ctx.db.insert('pushTestSends', { userId: user._id, sentAt: now });
    await ctx.scheduler.runAfter(TEST_SEND_WINDOW_MS, internal.pushSend.expireTestSend, {
      id: sendId,
    });
    for (const device of devices) {
      await ctx.scheduler.runAfter(0, internal.pushSend.deliver, {
        subscriptionId: device._id,
        userId: user._id,
        message: TEST_MESSAGE,
      });
    }
    return { status: 'sent' as const, devices: devices.length };
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
export const UNSEEN_ROW_MAX_AGE_MS = 90 * DAY_MS;
export const PRUNE_UNSEEN_PAGE_SIZE = 100;

function isUnused(row: Doc<'pushSubscriptions'>, cutoff: number): boolean {
  return row.lastSeenAt < cutoff && (row.lastSuccessAt === undefined || row.lastSuccessAt < cutoff);
}

// 404 and 410 arrive only on a send, so a row for a device that never gets one would otherwise stay.
export const pruneUnseen = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    cutoff: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (env.IS_TEST === 'true') return null;
    // Every page reads the same index range, so the cursor stays valid across runs.
    const cutoff = args.cutoff ?? Date.now() - UNSEEN_ROW_MAX_AGE_MS;
    const page = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_lastSeenAt', (q) => q.lt('lastSeenAt', cutoff))
      .paginate({ cursor: args.cursor ?? null, numItems: PRUNE_UNSEEN_PAGE_SIZE });
    for (const row of page.page) {
      if (isUnused(row, cutoff)) await ctx.db.delete('pushSubscriptions', row._id);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.push.pruneUnseen, {
        cursor: page.continueCursor,
        cutoff,
      });
    }
    return null;
  },
});
