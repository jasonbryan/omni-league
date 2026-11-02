import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { MAX_IP_LIMIT_KEY_LENGTH } from './lib/ipRateLimit';

export const PRUNE_BATCH_SIZE = 500;

const SECOND_MS = 1000;

const consumeResult = v.object({
  allowed: v.boolean(),
  retryAfter: v.union(v.number(), v.null()),
});

function checkArgs(key: string, window: number, max: number): void {
  if (key.length > MAX_IP_LIMIT_KEY_LENGTH) {
    throw new Error(`A per-IP limit key is at most ${MAX_IP_LIMIT_KEY_LENGTH} characters`);
  }
  if (!Number.isInteger(window) || window < 1 || !Number.isInteger(max) || max < 1) {
    throw new Error('A per-IP limit rule needs a whole number of seconds and requests');
  }
}

// Better Auth's database rule, decided and written in one transaction: Convex runs the mutations one
// after another, so parallel requests cannot all pass one stale count.
export const consume = internalMutation({
  args: { key: v.string(), window: v.number(), max: v.number() },
  returns: consumeResult,
  handler: async (ctx, { key, window, max }) => {
    checkArgs(key, window, max);
    const now = Date.now();
    const windowMs = window * SECOND_MS;
    const allowed = { allowed: true, retryAfter: null };
    const row = await ctx.db
      .query('ipRateLimits')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!row) {
      await ctx.db.insert('ipRateLimits', {
        key,
        count: 1,
        lastRequest: now,
        expiresAt: now + windowMs,
      });
      return allowed;
    }
    if (now - row.lastRequest > windowMs) {
      await ctx.db.patch('ipRateLimits', row._id, {
        count: 1,
        lastRequest: now,
        expiresAt: now + windowMs,
      });
      return allowed;
    }
    // A refusal writes nothing, so asking again cannot stretch the wait past one window.
    if (row.count >= max) {
      return {
        allowed: false,
        retryAfter: Math.ceil((row.lastRequest + windowMs - now) / SECOND_MS),
      };
    }
    await ctx.db.patch('ipRateLimits', row._id, {
      count: row.count + 1,
      lastRequest: now,
      expiresAt: now + windowMs,
    });
    return allowed;
  },
});

export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('ipRateLimits')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', Date.now()))
      .take(PRUNE_BATCH_SIZE);
    for (const row of expired) await ctx.db.delete('ipRateLimits', row._id);
    if (expired.length === PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.ipRateLimits.prune, {});
    }
    return null;
  },
});
